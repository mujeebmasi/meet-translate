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

// OpenAI's text pieces usually carry their own spaces (" hear"), so they're
// glued on as they come. But a piece that starts after a pause sometimes
// has none, which ran words together in a real test ("appthat",
// "budgetfor"). Pieces of one word arrive in one quick burst, so a missing
// space is only added after a pause.
const WORD_PAUSE_MS = 300;
function joinPieces(text: string, piece: string, msSinceLastPiece: number): string {
  const wordsWouldTouch = /[\p{L}\p{N}.,!?।]$/u.test(text) && /^[\p{L}\p{N}]/u.test(piece);
  return text + (wordsWouldTouch && msSinceLastPiece > WORD_PAUSE_MS ? ' ' : '') + piece;
}

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
  // A line is one sentence: the speaker's words and their English. A new
  // line starts when the speaker starts talking again after a pause.
  const newLine = (): CaptionLine => ({ id: crypto.randomUUID(), original: '', english: '', done: false });
  let line = newLine();
  let previous: CaptionLine | null = null; // the last finished line
  let lastOriginalAt = 0;
  let lastEnglishAt = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const finishLine = () => {
    if (line.english || line.original) {
      line.done = true;
      options.onLine({ ...line });
      previous = line;
    }
    line = newLine();
  };

  const addOriginal = (piece: string) => {
    const now = Date.now();
    if (line.original && now - lastOriginalAt > LINE_PAUSE_MS) finishLine();
    line.original = joinPieces(line.original, piece, now - lastOriginalAt);
    lastOriginalAt = now;
  };

  const addEnglish = (piece: string) => {
    const now = Date.now();
    // The English runs behind the speaker. When it arrives after a pause and
    // the speaker hasn't said anything new yet, it's the end (or a
    // correction) of the sentence before, so it goes back on that line. In a
    // real test it used to land on a line of its own, under the wrong words.
    if (!line.original && !line.english && previous) {
      line = previous;
      line.done = false;
    }
    line.english = joinPieces(line.english, piece, now - lastEnglishAt);
    lastEnglishAt = now;
  };

  const events = pc.createDataChannel('oai-events');
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'session.output_transcript.delta') addEnglish(event.delta);
    else if (event.type === 'session.input_transcript.delta') addOriginal(event.delta);
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
