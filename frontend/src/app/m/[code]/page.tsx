'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { api, errorMessage, WS_URL } from '@/lib/api';
import { LANGUAGES, TRANSLATORS, canTranslate, type Peer } from '@/lib/types';
import { startTranslator, type CaptionLine } from '@/lib/translator';
import { Button, Card, ErrorText, Label } from '@/components/ui';
import { VideoTile } from '@/components/video-tile';

// The free server forgot this meeting (it restarts after ~15 idle minutes).
const MEETING_GONE = 'This meeting has ended: the server restarted. Create a new meeting to continue.';

interface RemotePeer extends Peer {
  pc: RTCPeerConnection | null; // the video call connection to them
  stream: MediaStream | null; // their camera + mic, once it arrives
  link: RTCPeerConnectionState;
}

interface Caption extends CaptionLine {
  name: string; // who said it
}

export default function MeetingRoom() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  // --- lobby ---
  const [meetingTitle, setMeetingTitle] = useState('');
  const [translator, setTranslator] = useState(''); // which OpenAI model, see TRANSLATORS
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : localStorage.getItem('omt:name') || ''));
  const [lang, setLang] = useState(() =>
    typeof window === 'undefined' ? 'en' : localStorage.getItem('omt:lang') || 'en',
  );
  const [lobbyError, setLobbyError] = useState('');
  const [joining, setJoining] = useState(false);

  // --- call ---
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [talking, setTalking] = useState(false); // holding "Hold to talk" (push to talk)
  const [cameraOff, setCameraOff] = useState(false);
  // Shown above the call when the link to our server drops (see connectSocket).
  const [serverNotice, setServerNotice] = useState('');

  // --- translation ---
  const [translateOn, setTranslateOn] = useState(true); // do I want to hear others translated
  const [captions, setCaptions] = useState<Caption[]>([]);
  // Per listener: my voice translated for them, once it flows, or what went wrong.
  const [translations, setTranslations] = useState<Record<string, { voice?: MediaStream; error?: string }>>({});

  const socketRef = useRef<Socket | null>(null);
  const mySocketIdRef = useRef('');
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  // The running translations of my voice, by listener. A ref, not state:
  // starting and stopping them shouldn't re-render anything by itself.
  const translatorsRef = useRef(new Map<string, { stop: () => void }>());

  useEffect(() => {
    api
      .getMeeting(code)
      .then((meeting) => {
        setMeetingTitle(meeting.title);
        setTranslator(meeting.translator);
      })
      .catch(() => setNotFound(true));
  }, [code]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setLobbyError('');
    setJoining(true);
    localStorage.setItem('omt:name', name);
    localStorage.setItem('omt:lang', lang);

    let stream: MediaStream;
    try {
      // echoCancellation stops the mic picking up the other people (and
      // the English voice) from the speakers.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: true,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // no camera
      } catch {
        setLobbyError(
          'Your microphone is blocked. Allow it from the lock icon next to the address bar, then try again.',
        );
        setJoining(false);
        return;
      }
    }
    // Push to talk: the mic stays off until "Hold to talk" is held.
    stream.getAudioTracks().forEach((track) => (track.enabled = false));
    setLocalStream(stream);
    connectSocket(stream);
  }

  function connectSocket(stream: MediaStream) {
    const socket = io(WS_URL, { path: '/ws' });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', { code, name, lang }));

    socket.on('welcome', (msg: { you: string; title: string; peers: Peer[]; iceServers: RTCIceServer[] }) => {
      mySocketIdRef.current = msg.you;
      setServerNotice('');
      if (msg.iceServers?.length) iceServersRef.current = msg.iceServers;
      setMeetingTitle(msg.title);
      setJoined(true);
      setJoining(false);
      // The newcomer calls everyone already here. Only one side ever makes
      // the offer, so two people never call each other at the same time.
      msg.peers.forEach((p) => callPeer(p, stream));
    });

    socket.on('peer-joined', (msg: { peer: Peer }) => upsertPeer(msg.peer)); // they will call us

    // Someone changed language. This also reaches the person who changed
    // it, so only people already on the list are updated -- adding unknown
    // ones once showed me a copy of myself, stuck on "Connecting...".
    socket.on('peer-updated', (msg: { peer: Peer }) =>
      updatePeer(msg.peer.socketId, {
        lang: msg.peer.lang,
        translateOn: msg.peer.translateOn,
        talking: msg.peer.talking,
      }),
    );

    // Push to talk: someone else got the floor a moment before me.
    socket.on('talk-denied', () => {
      stream.getAudioTracks().forEach((track) => (track.enabled = false));
      setTalking(false);
    });

    // A line of what someone else said, translated for me by their browser
    // (again each time it grows).
    socket.on('caption', (caption: Caption) => upsertCaption(caption));

    socket.on('peer-left', (msg: { socketId: string }) => {
      setPeers((prev) => {
        prev.find((p) => p.socketId === msg.socketId)?.pc?.close();
        return prev.filter((p) => p.socketId !== msg.socketId);
      });
    });

    socket.on(
      'signal',
      (msg: { from: string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) =>
        handleSignal(msg.from, msg.data, stream),
    );

    socket.on('full', () => setLobbyError('This meeting is full.'));
    socket.on('connect_error', () => {
      setLobbyError('Could not reach the server.');
      setJoining(false);
    });

    // The link to our server dropped. Usually a network blip: it reconnects
    // and rejoins by itself. But the free server also restarts after ~15
    // idle minutes, which forgets every meeting -- then it turns the rejoin
    // away ("io server disconnect"), and before this the page just went
    // quiet, or sat on "Joining..." forever.
    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return; // we left on purpose
      const meetingGone = reason === 'io server disconnect';
      if (!mySocketIdRef.current) {
        setLobbyError(meetingGone ? MEETING_GONE : 'Lost the connection to the server. Try again.');
        setJoining(false);
      } else {
        setServerNotice(meetingGone ? MEETING_GONE : 'Lost the connection to the server. Reconnecting...');
      }
    });
  }

  // ---------- video call (WebRTC, browser to browser) ----------

  function createConnection(peerId: string, stream: MediaStream): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (event) => {
      if (event.candidate) socketRef.current?.emit('signal', { to: peerId, data: { candidate: event.candidate } });
    };
    pc.ontrack = (event) => updatePeer(peerId, { stream: event.streams[0] });
    pc.onconnectionstatechange = () => updatePeer(peerId, { link: pc.connectionState });
    updatePeer(peerId, { pc });
    return pc;
  }

  // Who someone is (name, language) and their connection arrive at
  // different moments, so they're two separate updates.
  function upsertPeer(info: Peer) {
    setPeers((prev) =>
      prev.some((p) => p.socketId === info.socketId)
        ? prev.map((p) => (p.socketId === info.socketId ? { ...p, ...info } : p))
        : [...prev, { ...info, pc: null, stream: null, link: 'new' }],
    );
  }

  function updatePeer(socketId: string, changes: Partial<RemotePeer>) {
    setPeers((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, ...changes } : p)));
  }

  async function callPeer(info: Peer, stream: MediaStream) {
    upsertPeer(info);
    const pc = createConnection(info.socketId, stream);
    await pc.setLocalDescription(await pc.createOffer());
    socketRef.current?.emit('signal', { to: info.socketId, data: { description: pc.localDescription } });
  }

  // State can lag a render behind fast signal messages, so the current
  // connections are read from a ref kept in sync with `peers`.
  const peersRef = useRef<RemotePeer[]>([]);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  async function handleSignal(
    fromId: string,
    data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
    stream: MediaStream,
  ) {
    const existing = peersRef.current.find((p) => p.socketId === fromId)?.pc;
    if (data.description?.type === 'offer') {
      const pc = createConnection(fromId, stream);
      await pc.setRemoteDescription(data.description);
      await pc.setLocalDescription(await pc.createAnswer());
      socketRef.current?.emit('signal', { to: fromId, data: { description: pc.localDescription } });
    } else if (data.description && existing) {
      await existing.setRemoteDescription(data.description);
    } else if (data.candidate && existing) {
      await existing.addIceCandidate(data.candidate);
    }
  }

  // ---------- translation (OpenAI) ----------
  //
  // Everyone translates their OWN voice: my browser sends my mic to OpenAI,
  // and the translation replaces my voice in what the listener receives.
  // It used to be the other way round -- the listener's browser translated
  // the voice it received -- but that voice had first crossed the call
  // connection (often a slow relay), which made real calls much slower
  // than Meet Translate, and its pauses were harder to find.

  // Whether this person hears ME translated: the meeting's model can
  // translate my language into theirs, and their switch is on.
  function translateMeFor(peer: Peer) {
    return peer.translateOn !== false && canTranslate(lang, peer.lang, translator);
  }

  // Whether I hear this person translated (for the label on their tile).
  function isTranslatedForMe(peer: Peer) {
    return translateOn && canTranslate(peer.lang, lang, translator);
  }

  async function startTranslation(peer: RemotePeer) {
    const mic = localStream!.getAudioTracks()[0];
    const update = (changes: { voice?: MediaStream; error?: string }) =>
      setTranslations((prev) => ({ ...prev, [peer.socketId]: { ...prev[peer.socketId], ...changes } }));

    // Registered straight away (before the awaits), so the effect below
    // doesn't start a second one, and can stop this one mid-start.
    let stopped = false;
    let translator: { stop: () => void } | null = null;
    translatorsRef.current.set(peer.socketId, {
      stop: () => {
        stopped = true;
        translator?.stop();
      },
    });

    try {
      const session = await api.startTranslation(code, mySocketIdRef.current, peer.socketId);
      if (stopped) return;
      translator = await startTranslator(session.translator, {
        source: mic,
        clientSecret: session.clientSecret,
        onAudio: (voice) => {
          keepFlowing(voice);
          update({ voice, error: undefined });
        },
        onLine: (line) => {
          // I see how I was understood; the listener gets the line through
          // our server (which also logs finished lines).
          upsertCaption({ ...line, id: `mine:${line.id}`, name: `You → ${LANGUAGES[peer.lang]}` });
          socketRef.current?.emit('caption', { listener: peer.socketId, ...line });
        },
        onError: (error) => update({ error }),
      });
      if (stopped) translator.stop();
    } catch (err) {
      // Not retried automatically: switching translation off and on, or
      // rejoining, retries.
      if (!stopped) update({ error: errorMessage(err) });
    }
  }

  // A caption line arrives again every time it grows, so update it in place.
  function upsertCaption(caption: Caption) {
    setCaptions((prev) => {
      const i = prev.findIndex((c) => c.id === caption.id);
      if (i === -1) return [...prev.slice(-50), caption];
      const next = [...prev];
      next[i] = caption;
      return next;
    });
  }

  // Keeps exactly one running translation of my voice per person who needs
  // it, and none otherwise: it stops the moment it isn't needed (they
  // leave, someone changes language, or they switch translation off).
  useEffect(() => {
    if (!joined || !localStream?.getAudioTracks()[0]) return;
    const wanted = peers.filter((p) => translateMeFor(p));
    for (const [socketId, translator] of translatorsRef.current) {
      if (!wanted.some((p) => p.socketId === socketId)) {
        translator.stop();
        translatorsRef.current.delete(socketId);
      }
    }
    for (const peer of wanted) {
      if (!translatorsRef.current.has(peer.socketId)) void startTranslation(peer);
    }
    // translateMeFor only reads lang and translator, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, peers, lang, translator, localStream]);

  // What each person receives as my voice: my translation for them once it
  // flows, my own mic otherwise. Swapping the track on the call connection
  // needs no reconnecting.
  useEffect(() => {
    const mic = localStream?.getAudioTracks()[0];
    if (!mic) return;
    for (const peer of peers) {
      const sender = peer.pc?.getTransceivers().find((t) => t.receiver.track.kind === 'audio')?.sender;
      const translated = translateMeFor(peer) ? translations[peer.socketId]?.voice?.getAudioTracks()[0] : undefined;
      const track = translated ?? mic;
      if (sender && sender.track !== track) void sender.replaceTrack(track);
    }
    // translateMeFor only reads lang and translator, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, translations, localStream, lang, translator]);

  // Keep the captions scrolled to the newest line.
  const captionBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = captionBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [captions]);

  // ---------- controls ----------

  // Push to talk: my mic reaches the call and the translator only while I
  // hold "Hold to talk" (or Space). When I let go, the translator hears
  // silence, so it finishes my last sentence and then stays quiet. One
  // person at a time: the server refuses ('talk-denied') if someone else
  // already has the floor.
  const otherTalking = peers.find((p) => p.talking);

  function startTalking() {
    const mic = localStream?.getAudioTracks()[0];
    if (!mic || talking || otherTalking) return;
    mic.enabled = true;
    setTalking(true);
    socketRef.current?.emit('talk', { on: true });
  }

  function stopTalking() {
    const mic = localStream?.getAudioTracks()[0];
    if (!mic || !talking) return;
    mic.enabled = false;
    setTalking(false);
    socketRef.current?.emit('talk', { on: false });
  }

  // Space works too -- except while typing or choosing in a field.
  useEffect(() => {
    if (!joined) return;
    const inField = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && e.target.closest('input, select, textarea');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || inField(e)) return;
      e.preventDefault();
      startTalking();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || inField(e)) return;
      e.preventDefault();
      stopTalking();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // startTalking/stopTalking only read the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, talking, otherTalking, localStream]);

  function toggleCamera() {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  function changeTranslateOn(on: boolean) {
    setTranslateOn(on);
    socketRef.current?.emit('set-translate', { on }); // the speakers' browsers do the translating
  }

  function changeLang(newLang: string) {
    setLang(newLang);
    localStorage.setItem('omt:lang', newLang);
    socketRef.current?.emit('set-lang', { lang: newLang });
  }

  const [copied, setCopied] = useState(false);
  function copyInviteLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function hangUp() {
    translatorsRef.current.forEach((t) => t.stop());
    translatorsRef.current.clear();
    socketRef.current?.disconnect();
    localStream?.getTracks().forEach((t) => t.stop());
  }

  function leave() {
    hangUp();
    router.push('/start');
  }

  // Also hang up if the page goes away without the Leave button.
  useEffect(() => {
    return hangUp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- render ----------

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <h2 className="text-2xl font-semibold">Meeting not found</h2>
        <p className="text-muted">
          Check the link or code. Meetings also end when the server restarts (it does after ~15 idle minutes), so it may
          need creating again.
        </p>
        <Link href="/start" className="text-sm text-brand hover:underline">
          Create a new meeting
        </Link>
      </main>
    );
  }

  if (!joined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{meetingTitle || 'Loading meeting...'}</h2>
          {!meetingTitle && <p className="text-sm text-muted">The server may take up to a minute to wake up.</p>}
          <form onSubmit={join} className="flex flex-col gap-3">
            <div>
              <Label>Your name</Label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </div>
            <div>
              <Label>The language you will speak</Label>
              <LanguageSelect value={lang} onChange={setLang} />
              <p className="mt-1 text-xs text-muted">
                You hear the others in this language.{' '}
                {translator !== 'gpt-realtime-translate'
                  ? 'Hindi and Telugu speakers are translated into English and into each other; English speakers into Hindi or Telugu.'
                  : 'Hindi and Telugu speakers are translated into English.'}
              </p>
            </div>
            <Button type="submit" disabled={joining || !meetingTitle}>
              {joining ? 'Joining...' : 'Join meeting'}
            </Button>
            {lobbyError && <ErrorText>{lobbyError}</ErrorText>}
          </form>
        </Card>
      </main>
    );
  }

  // Whether anyone here is (or could be) translated for me: decides whether
  // my translate switch means anything.
  const listening = peers.some((p) => canTranslate(p.lang, lang, translator));
  const errors = peers.filter((p) => translateMeFor(p) && translations[p.socketId]?.error);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <strong className="min-w-0 truncate">{meetingTitle}</strong>
        {translator && (
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs text-brand">
            {TRANSLATORS[translator]?.name ?? translator}
          </span>
        )}
        <Button variant="quiet" className="text-xs" onClick={copyInviteLink}>
          {copied ? 'Copied!' : 'Copy invite link'}
        </Button>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          I speak
          <LanguageSelect value={lang} onChange={changeLang} className="w-auto" />
        </label>
      </header>

      {serverNotice && <p className="bg-warn-soft px-4 py-2 text-sm text-warn">{serverNotice}</p>}

      <section className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2 overflow-auto p-2">
        <VideoTile
          stream={localStream}
          muted
          mirror
          videoOff={cameraOff}
          name={name}
          label={`${name} (you) · ${LANGUAGES[lang]}`}
          talking={talking}
        />
        {peers.map((p) => (
          <VideoTile
            key={p.socketId}
            stream={p.stream}
            name={p.name}
            label={`${p.name} · ${LANGUAGES[p.lang] ?? p.lang}${isTranslatedForMe(p) ? ` → ${LANGUAGES[lang]}` : ''}`}
            notice={p.link === 'failed' ? "Can't connect on this network." : undefined}
            talking={p.talking}
          />
        ))}
        {peers.length === 0 && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line p-4 text-center">
            <p className="text-sm text-muted">Nobody else is here yet. Send them the invite link.</p>
            <Button variant="quiet" className="text-xs" onClick={copyInviteLink}>
              {copied ? 'Copied!' : 'Copy invite link'}
            </Button>
          </div>
        )}
      </section>

      <section className="border-t border-line bg-surface px-4 py-2">
        <div ref={captionBoxRef} className="h-36 overflow-y-auto">
          {captions.length === 0 && (
            <p className="py-1 text-sm text-muted">
              Translated captions appear here: yours as the others hear you, and theirs.
            </p>
          )}
          {captions
            // A reply to a filler sound ("um") can come back empty: hide it.
            .filter((c) => !c.done || c.english.trim())
            .map((c) => (
              <div key={c.id} className="py-1">
                <b className="text-brand">{c.name}</b> {c.english}
                {!c.done && <span className="text-muted"> ...</span>}
                {c.original && <small className="block text-muted">{c.original}</small>}
                {(c.timing?.voiceMs !== undefined || c.timing?.fromStartMs !== undefined) && (
                  <small className="block text-xs text-muted">{timingNote(c.timing)}</small>
                )}
              </div>
            ))}
        </div>
        {errors.map((p) => (
          <p key={p.socketId} className="mt-1 text-xs text-bad">
            Translating your voice for {p.name} stopped: {translations[p.socketId]?.error}
          </p>
        ))}
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3">
        {/* Push to talk: hold (mouse, finger) to talk, let go to stop. A
            plain <button>, as the press-and-release events are needed. */}
        <button
          type="button"
          disabled={!!otherTalking}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId); // still "held" if the finger slides off
            startTalking();
          }}
          onPointerUp={stopTalking}
          onPointerCancel={stopTalking}
          onContextMenu={(e) => e.preventDefault()} // a long press on a phone opens no menu
          className={`touch-none rounded-lg px-6 py-3 text-sm font-semibold transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50 ${
            talking ? 'bg-bad text-white' : 'bg-brand text-white hover:bg-brand-dark'
          }`}
        >
          {talking
            ? 'Talking… let go to stop'
            : otherTalking
              ? `${otherTalking.name} is talking…`
              : 'Hold to talk (or Space)'}
        </button>
        <Button variant={cameraOff ? 'danger' : 'quiet'} onClick={toggleCamera}>
          {cameraOff ? 'Camera on' : 'Camera off'}
        </Button>
        {listening && (
          <label className="flex items-center gap-2 text-sm whitespace-nowrap" title="Off: hear their own voice">
            <input
              type="checkbox"
              checked={translateOn}
              onChange={(e) => changeTranslateOn(e.target.checked)}
              className="w-auto"
            />
            Translate to {LANGUAGES[lang]}
          </label>
        )}
        <Button variant="danger" className="ml-auto" onClick={leave}>
          Leave
        </Button>
      </footer>
    </main>
  );
}

// Under each caption: how long they talked, and how fast the translated
// voice followed. Shows whether a long wait was the speaker's own sentence
// or the translator. ("pause" = the 0.5s of quiet that ends a sentence.)
function timingNote(timing: { voiceMs?: number; spokeMs?: number; fromStartMs?: number; queueMs?: number }): string {
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  // Gemini translates while they talk, so it's timed from when they started.
  if (timing.fromStartMs !== undefined) {
    const queued = (timing.queueMs ?? 0) >= 300 ? ` (${seconds(timing.queueMs!)} s queued)` : '';
    return `voice ${seconds(timing.fromStartMs)} s after they started speaking${queued}`;
  }
  const spoke = timing.spokeMs ? `spoke ${seconds(timing.spokeMs)} s · ` : '';
  return `${spoke}voice ${seconds(timing.voiceMs ?? 0)} s after the pause`;
}

// A track from OpenAI only keeps flowing -- and so can be passed on to the
// listener -- while something plays it. A muted <audio> does, without me
// hearing my own translation.
function keepFlowing(stream: MediaStream) {
  const audio = new Audio();
  audio.muted = true;
  audio.srcObject = stream;
  void audio.play().catch(() => {});
}

function LanguageSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (lang: string) => void;
  className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {Object.entries(LANGUAGES).map(([code, langName]) => (
        <option key={code} value={code}>
          {langName}
        </option>
      ))}
    </select>
  );
}
