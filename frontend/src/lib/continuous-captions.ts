// Caption lines for the translators that translate while the speaker is
// still talking (gpt-realtime-translate, Gemini Live Translate). Their text
// comes as one continuous stream of pieces, with no sentences or turns, so
// lines are cut here: a line ends after a pause with no new words.

import type { CaptionLine } from './openai-connection';

const LINE_PAUSE_MS = 1500;

// Text pieces usually carry their own spaces (" hear"), so they're glued on
// as they come. But a piece that starts after a pause sometimes has none,
// which ran words together in a real test ("appthat", "budgetfor"). Pieces
// of one word arrive in one quick burst, so a missing space is only added
// after a pause.
const WORD_PAUSE_MS = 300;
function joinPieces(text: string, piece: string, msSinceLastPiece: number): string {
  if (!text) return piece.trimStart(); // a new line doesn't start with a space
  const wordsWouldTouch = /[\p{L}\p{N}.,!?।]$/u.test(text) && /^[\p{L}\p{N}]/u.test(piece);
  return text + (wordsWouldTouch && msSinceLastPiece > WORD_PAUSE_MS ? ' ' : '') + piece;
}

export function continuousCaptions(onLine: (line: CaptionLine) => void) {
  // A line is one sentence: the speaker's words and their translation. A
  // new line starts when the speaker starts talking again after a pause.
  const newLine = (): CaptionLine => ({ id: crypto.randomUUID(), original: '', english: '', done: false });
  let line = newLine();
  let previous: CaptionLine | null = null; // the last finished line
  let lastOriginalAt = 0;
  let lastTranslationAt = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;

  const finishLine = () => {
    if (line.english || line.original) {
      line.done = true;
      onLine({ ...line });
      previous = line;
    }
    line = newLine();
  };

  // After every new piece: show the line, and end it if nothing follows.
  const changed = () => {
    onLine({ ...line });
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(finishLine, LINE_PAUSE_MS);
  };

  return {
    addOriginal(piece: string) {
      const now = Date.now();
      if (line.original && now - lastOriginalAt > LINE_PAUSE_MS) finishLine();
      line.original = joinPieces(line.original, piece, now - lastOriginalAt);
      lastOriginalAt = now;
      changed();
    },

    addTranslation(piece: string) {
      const now = Date.now();
      // The translation runs behind the speaker. When it arrives after a
      // pause and the speaker hasn't said anything new yet, it's the end (or
      // a correction) of the sentence before, so it goes back on that line.
      // In a real test it used to land on a line of its own, under the
      // wrong words.
      if (!line.original && !line.english && previous) {
        line = previous;
        line.done = false;
      }
      line.english = joinPieces(line.english, piece, now - lastTranslationAt);
      lastTranslationAt = now;
      changed();
    },

    // How fast the translated voice followed (Gemini only, see gemini-session.ts).
    setTiming(timing: CaptionLine['timing']) {
      line.timing = timing;
      changed();
    },

    stop() {
      clearTimeout(pauseTimer);
    },
  };
}
