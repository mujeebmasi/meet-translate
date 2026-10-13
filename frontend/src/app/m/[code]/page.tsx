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

// A speaker's own voice is muted while their English translation plays, so
// the listener hears only English. (Trade-off: the translator says nothing
// for words already spoken in English, like "meeting" or "okay", so those
// aren't heard either -- they still show in the captions underneath.)
const ORIGINAL_VOLUME_UNDER_TRANSLATION = 0;

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
  const [lang, setLang] = useState(() => (typeof window === 'undefined' ? 'en' : localStorage.getItem('omt:lang') || 'en'));
  const [lobbyError, setLobbyError] = useState('');
  const [joining, setJoining] = useState(false);

  // --- call ---
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  // --- translation (only used when I listen in English) ---
  const [translateOn, setTranslateOn] = useState(true);
  const [captions, setCaptions] = useState<Caption[]>([]);
  // Per speaker: their English voice once it arrives, or what went wrong.
  const [translations, setTranslations] = useState<Record<string, { english?: MediaStream; error?: string }>>({});

  const socketRef = useRef<Socket | null>(null);
  const mySocketIdRef = useRef('');
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  // The running translations, by speaker. A ref, not state: starting and
  // stopping them shouldn't re-render anything by itself.
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
        setLobbyError('Your microphone is blocked. Allow it from the lock icon next to the address bar, then try again.');
        setJoining(false);
        return;
      }
    }
    setLocalStream(stream);
    connectSocket(stream);
  }

  function connectSocket(stream: MediaStream) {
    const socket = io(WS_URL, { path: '/ws' });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', { code, name, lang }));

    socket.on('welcome', (msg: { you: string; title: string; peers: Peer[]; iceServers: RTCIceServer[] }) => {
      mySocketIdRef.current = msg.you;
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
    socket.on('peer-updated', (msg: { peer: Peer }) => updatePeer(msg.peer.socketId, { lang: msg.peer.lang }));

    socket.on('peer-left', (msg: { socketId: string }) => {
      setPeers((prev) => {
        prev.find((p) => p.socketId === msg.socketId)?.pc?.close();
        return prev.filter((p) => p.socketId !== msg.socketId);
      });
    });

    socket.on('signal', (msg: { from: string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) =>
      handleSignal(msg.from, msg.data, stream),
    );

    socket.on('full', () => setLobbyError('This meeting is full.'));
    socket.on('connect_error', () => {
      setLobbyError('Could not reach the server.');
      setJoining(false);
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

  // Whether I hear this person through the translator.
  // Everyone hears the others in their own "I speak" language, where this
  // meeting's model can do that direction.
  function isTranslatedForMe(peer: Peer) {
    return translateOn && canTranslate(peer.lang, lang, translator);
  }

  async function startTranslation(peer: RemotePeer) {
    const source = peer.stream!.getAudioTracks()[0];
    const update = (changes: { english?: MediaStream; error?: string }) =>
      setTranslations((prev) => ({ ...prev, [peer.socketId]: { ...prev[peer.socketId], ...changes } }));

    // Registered straight away (before the awaits), so the effect above
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
        source,
        clientSecret: session.clientSecret,
        onAudio: (english) => update({ english, error: undefined }),
        onLine: (line) => {
          upsertCaption({ ...line, name: peer.name });
          // Finished lines also go to the server's log (see handleCaption).
          if (line.done)
            socketRef.current?.emit('caption', {
              speaker: peer.socketId,
              original: line.original,
              english: line.english,
              usage: line.usage,
              timing: line.timing,
            });
        },
        onError: (error) => update({ error }),
      });
      if (stopped) translator.stop();
    } catch (err) {
      // Not retried automatically (each try costs money): switching
      // translation off and on again retries.
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

  // Keeps exactly one running translation per Hindi/Telugu speaker I can
  // hear, and none otherwise -- each one is billed per minute, so it stops
  // the moment it isn't needed (they leave, someone changes language, or I
  // switch translation off).
  useEffect(() => {
    if (!joined) return;
    const wanted = peers.filter((p) => isTranslatedForMe(p) && p.stream?.getAudioTracks()[0]);
    for (const [socketId, translator] of translatorsRef.current) {
      if (!wanted.some((p) => p.socketId === socketId)) {
        translator.stop();
        translatorsRef.current.delete(socketId);
      }
    }
    for (const peer of wanted) {
      if (!translatorsRef.current.has(peer.socketId)) void startTranslation(peer);
    }
    // isTranslatedForMe only reads translateOn, lang and translator, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, peers, lang, translateOn, translator]);

  // Keep the captions scrolled to the newest line.
  const captionBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = captionBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [captions]);

  // ---------- controls ----------

  function toggleMute() {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  function toggleCamera() {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
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
    router.push('/');
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
        <p className="text-muted">Check the link or code and try again.</p>
        <Link href="/" className="text-sm text-brand hover:underline">
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
                {translator === 'gpt-realtime-2'
                  ? 'Hindi and Telugu speakers are translated into English, and into each other.'
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
  // the captions box and the translate switch mean anything to me.
  const listening = peers.some((p) => canTranslate(p.lang, lang, translator)) || lang === 'en';
  const errors = peers.filter((p) => isTranslatedForMe(p) && translations[p.socketId]?.error);

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

      <section className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2 overflow-auto p-2">
        <VideoTile
          stream={localStream}
          muted
          mirror
          videoOff={cameraOff}
          name={name}
          label={`${name} (you) · ${LANGUAGES[lang]}${muted ? ' · mic off' : ''}`}
        />
        {peers.map((p) => {
          const translated = isTranslatedForMe(p) && !!translations[p.socketId]?.english;
          return (
            <VideoTile
              key={p.socketId}
              stream={p.stream}
              volume={translated ? ORIGINAL_VOLUME_UNDER_TRANSLATION : 1}
              english={isTranslatedForMe(p) ? translations[p.socketId]?.english : null}
              name={p.name}
              label={`${p.name} · ${LANGUAGES[p.lang] ?? p.lang}${translated ? ` → ${LANGUAGES[lang]}` : ''}`}
              notice={p.link === 'failed' ? "Can't connect on this network." : undefined}
            />
          );
        })}
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
          {!listening && (
            <p className="py-1 text-sm text-muted">
              Speak {LANGUAGES[lang]}. The others hear you translated into their language.
            </p>
          )}
          {listening && captions.length === 0 && (
            <p className="py-1 text-sm text-muted">Translated captions appear here when someone speaks.</p>
          )}
          {listening &&
            captions
              // A reply to a filler sound ("um") can come back empty: hide it.
              .filter((c) => !c.done || c.english.trim())
              .map((c) => (
                <div key={c.id} className="py-1">
                  <b className="text-brand">{c.name}</b> {c.english}
                  {!c.done && <span className="text-muted"> ...</span>}
                  {c.original && <small className="block text-muted">{c.original}</small>}
                  {c.timing?.voiceMs !== undefined && (
                    <small className="block text-xs text-muted">{timingNote(c.timing)}</small>
                  )}
                </div>
              ))}
        </div>
        {errors.map((p) => (
          <p key={p.socketId} className="mt-1 text-xs text-bad">
            Translation for {p.name} stopped: {translations[p.socketId]?.error}
          </p>
        ))}
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3">
        <Button variant={muted ? 'danger' : 'quiet'} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button variant={cameraOff ? 'danger' : 'quiet'} onClick={toggleCamera}>
          {cameraOff ? 'Camera on' : 'Camera off'}
        </Button>
        {listening && (
          <label className="flex items-center gap-2 text-sm whitespace-nowrap" title="Billed per minute while on">
            <input type="checkbox" checked={translateOn} onChange={(e) => setTranslateOn(e.target.checked)} className="w-auto" />
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
function timingNote(timing: { voiceMs?: number; spokeMs?: number }): string {
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  const spoke = timing.spokeMs ? `spoke ${seconds(timing.spokeMs)} s · ` : '';
  return `${spoke}voice ${seconds(timing.voiceMs ?? 0)} s after the pause`;
}

function LanguageSelect({ value, onChange, className }: { value: string; onChange: (lang: string) => void; className?: string }) {
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
