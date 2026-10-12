// One live translation: a remote speaker's voice goes to OpenAI's
// gpt-realtime-translate, and English comes back as both speech and text,
// while they are still talking.
//
// It's a second WebRTC connection, this time between my browser and
// OpenAI: the speaker's incoming audio track is sent as-is, the English
// voice arrives as an audio track, and the text arrives on a data channel.
// No audio passes through our own server.

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/translations/calls';

// OpenAI sends text as a continuous stream, not as sentences. A caption
// line ends after this long with no new words.
const LINE_PAUSE_MS = 1500;

export interface CaptionLine {
  id: string;
  original: string; // what they said, in Hindi/Telugu script
  english: string;
  done: boolean; // false while words are still arriving
}

interface TranslatorOptions {
  source: MediaStreamTrack; // the speaker's voice, as received on the call
  clientSecret: string;
  onAudio: (english: MediaStream) => void;
  onLine: (line: CaptionLine) => void;
  onError: (message: string) => void;
}

export async function startTranslator(options: TranslatorOptions): Promise<{ stop: () => void }> {
  const pc = new RTCPeerConnection();
  pc.addTrack(options.source, new MediaStream([options.source]));
  pc.ontrack = (event) => options.onAudio(event.streams[0] ?? new MediaStream([event.track]));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') options.onError('Lost the connection to the translator.');
  };

  // --- captions ---
  const newLine = (): CaptionLine => ({ id: crypto.randomUUID(), original: '', english: '', done: false });
  let line = newLine();
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const finishLine = () => {
    if (line.english || line.original) options.onLine({ ...line, done: true });
    line = newLine();
  };

  const events = pc.createDataChannel('oai-events');
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    // Pieces of text are glued on exactly as they come: OpenAI's pieces
    // already carry their own spaces.
    if (event.type === 'session.output_transcript.delta') line.english += event.delta;
    else if (event.type === 'session.input_transcript.delta') line.original += event.delta;
    else if (event.type === 'error') return options.onError(event.error?.message ?? 'Translator error');
    else return;
    options.onLine({ ...line });
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(finishLine, LINE_PAUSE_MS);
  };

  // --- connect: send our offer to OpenAI, get its answer back ---
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const response = await fetch(OPENAI_CALLS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  });
  if (!response.ok) {
    pc.close();
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });

  return {
    // Closing the connection ends the session, and OpenAI stops billing.
    stop: () => {
      clearTimeout(pauseTimer);
      pc.close();
    },
  };
}
