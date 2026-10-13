// Translating with gpt-realtime-translate: OpenAI's dedicated interpreter
// model. English comes back as speech and text while the speaker is still
// talking, as one continuous stream (no sentences, no turns).

import { connectToOpenAI, type CaptionLine, type TranslatorOptions } from './openai-connection';

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

export async function startTranslate(options: TranslatorOptions): Promise<{ stop: () => void }> {
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

  const { pc } = await connectToOpenAI(options, OPENAI_CALLS_URL, (event) => {
    if (event.type === 'session.output_transcript.delta') addEnglish(event.delta);
    else if (event.type === 'session.input_transcript.delta') addOriginal(event.delta);
    else if (event.type === 'error') return options.onError(event.error?.message ?? 'Translator error');
    else return;
    options.onLine({ ...line });
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(finishLine, LINE_PAUSE_MS);
  });

  return {
    stop: () => {
      clearTimeout(pauseTimer);
      pc.close();
    },
  };
}
