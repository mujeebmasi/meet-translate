// Translating with gpt-realtime-2 -- OpenAI's voice-assistant model, told
// by our server's prompt to act as an interpreter (see the backend's
// interpreter-prompt.ts).
//
// Unlike gpt-realtime-translate it works turn by turn: OpenAI notices each
// pause in the speaker's voice and saves what came before it as one "item";
// we then ask for a reply, which is the translation. Replies are asked for
// one at a time: asking while one is still being spoken would cut it off,
// so a sentence that ends meanwhile waits for the current reply to finish.
//
// Each reply is given ONLY the new speech to translate (plus the last few
// translations as text, marked as already said). Given the whole call, the
// model answered unclear speech or a "hmm" by repeating its last
// translation -- with nothing to repeat, it can't.

import { connectToOpenAI, type CaptionLine, type TranslatorOptions } from './openai-connection';

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

// If the speaker's own words (transcribed separately) haven't arrived this
// long after the translation is finished, show the line without waiting.
const TRANSCRIPT_WAIT_MS = 3000;

// How long to wait for a doubtful item's transcript (see shouldTranslate)
// before translating it anyway.
const FILLER_CHECK_MS = 600;

// How many earlier translations each reply is shown, to understand what's
// being talked about.
const CONTEXT_LINES = 3;

// A pause that held only a filler sound: "hmm", "umm", "hun", a short
// laugh. Asking for a translation of these made the model repeat its last
// one, so they're skipped. Checked word by word, after dropping the
// nasal/half-letter marks, so "ह्म्म" and "हुं" match too. "हाँ" ("yes")
// is not a filler and is still translated.
const FILLER_WORD = /^(h+m+|m+|u+m+|u+h+|a+h+|hu+n|ह[ुू]?म*|उ+म*|अ+|హ[ుూ]?మ*|ఉ+మ*|అ+)$/;
export function isFiller(transcript: string): boolean {
  const words = transcript
    .toLowerCase()
    .replace(/[्ँंఁం్]/g, '') // virama, anusvara, chandrabindu
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.every((word) => FILLER_WORD.test(word)); // also true for no words at all
}

export async function startRealtime2(options: TranslatorOptions): Promise<{ stop: () => void }> {
  // Each caption line is one reply: the translation, plus the speaker's
  // words from every item it translated (usually one; two if they spoke
  // again while the last reply was still playing).
  const lines = new Map<string, CaptionLine>(); // reply id -> its line
  const itemsOf = new Map<CaptionLine, string[]>();
  const spoken = new Map<string, { text: string; complete: boolean }>(); // item id -> speaker's words
  const finished: CaptionLine[] = []; // for the earlier-translations context
  // Items in the order they were said, each waiting for the filler check.
  const checking: { id: string; verdict?: 'translate' | 'skip' }[] = [];
  let notYetTranslated: string[] = []; // passed the check, waiting for a reply
  let itemsBeingTranslated: string[] = [];
  let replying = false;
  let replyWanted = false;
  // When OpenAI last noticed the speaker pause -- the clock for each line's
  // timing. (It notices ~0.6s after they actually stop: that's the length
  // of quiet it waits for, set on the server.)
  let pauseNoticedAt = 0;
  const startedAt = new Map<CaptionLine, number>();

  const show = (line: CaptionLine) => options.onLine({ ...line });
  const refreshOriginal = (line: CaptionLine) => {
    line.original = (itemsOf.get(line) ?? []).map((id) => spoken.get(id)?.text ?? '').join(' ').trim();
  };
  // A line is finished once the translation is done and the speaker's own
  // words have arrived (they're transcribed separately, sometimes later).
  const finishIfReady = (line: CaptionLine, translationDone: boolean, force = false) => {
    const wordsReady = (itemsOf.get(line) ?? []).every((id) => spoken.get(id)?.complete);
    if (translationDone && (wordsReady || force) && !line.done) {
      line.done = true;
      show(line);
    }
  };
  const translationDone = new Set<CaptionLine>();

  // --- the filler check ---
  // Usually the transcript has already streamed in by the pause and shows
  // real words, so the item goes straight through. Only an item with no
  // words yet, or only filler so far, waits for its finished transcript
  // (at most FILLER_CHECK_MS; if it's late, translate rather than lose it).
  function check(id: string) {
    checking.push({ id });
    const soFar = spoken.get(id)?.text ?? '';
    if (soFar && !isFiller(soFar)) decide(id, 'translate');
    else setTimeout(() => decide(id, 'translate'), FILLER_CHECK_MS);
  }
  function decide(id: string, verdict: 'translate' | 'skip') {
    const entry = checking.find((c) => c.id === id);
    if (!entry || entry.verdict) return; // already decided
    entry.verdict = verdict;
    // Release decided items in the order they were said.
    while (checking[0]?.verdict) {
      const next = checking.shift()!;
      if (next.verdict === 'translate') notYetTranslated.push(next.id);
    }
    askForReply();
  }

  const { pc, events } = await connectToOpenAI(options, OPENAI_CALLS_URL, (event) => {
    switch (event.type) {
      case 'input_audio_buffer.speech_stopped':
        pauseNoticedAt = Date.now();
        break;

      // A pause: everything since the last pause is now one item.
      case 'input_audio_buffer.committed':
        check(event.item_id);
        break;

      case 'response.created': {
        const line: CaptionLine = { id: crypto.randomUUID(), original: '', english: '', done: false };
        lines.set(event.response.id, line);
        startedAt.set(line, pauseNoticedAt);
        itemsOf.set(line, itemsBeingTranslated);
        refreshOriginal(line);
        break;
      }

      case 'response.output_audio_transcript.delta': {
        const line = lines.get(event.response_id);
        if (!line) break;
        if (!line.english) line.timing = { ...line.timing, textMs: Date.now() - startedAt.get(line)! };
        line.english += event.delta;
        show(line);
        break;
      }

      // The translated voice actually starts playing (sent over WebRTC only).
      case 'output_audio_buffer.started': {
        const line = lines.get(event.response_id);
        if (line && line.timing?.voiceMs === undefined)
          line.timing = { ...line.timing, voiceMs: Date.now() - startedAt.get(line)! };
        break;
      }

      case 'response.done': {
        const line = lines.get(event.response.id);
        replying = false;
        if (replyWanted) askForReply();
        if (!line) break;
        line.usage = event.response.usage;
        translationDone.add(line);
        if (line.english.trim()) finished.push(line);
        finishIfReady(line, true);
        setTimeout(() => finishIfReady(line, true, true), TRANSCRIPT_WAIT_MS);
        break;
      }

      // The speaker's own words, transcribed separately from the translation.
      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.completed': {
        const done = event.type.endsWith('completed');
        const before = spoken.get(event.item_id)?.text ?? '';
        const text = done ? event.transcript : before + event.delta;
        spoken.set(event.item_id, { text, complete: done });
        if (done) decide(event.item_id, isFiller(text) ? 'skip' : 'translate');
        for (const line of itemsOf.keys()) {
          if (!itemsOf.get(line)!.includes(event.item_id)) continue;
          refreshOriginal(line);
          show(line);
          finishIfReady(line, translationDone.has(line));
        }
        break;
      }

      case 'error':
        replying = false; // a failed reply mustn't block the ones after it
        options.onError(event.error?.message ?? 'Translator error');
        break;
    }
  });

  function askForReply() {
    if (replying) {
      replyWanted = true;
      return;
    }
    if (notYetTranslated.length === 0) return;
    replying = true;
    replyWanted = false;
    itemsBeingTranslated = notYetTranslated;
    notYetTranslated = [];

    // The reply sees only this: the earlier translations as text (to
    // understand what's being talked about) and the new speech.
    const earlier = finished.slice(-CONTEXT_LINES).map((line) => `- ${line.english.trim()}`);
    const context = earlier.length
      ? [
          {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: `Earlier in this call, already translated -- only to help you understand. Never say any of it again:\n${earlier.join('\n')}`,
              },
            ],
          },
        ]
      : [];
    events.send(
      JSON.stringify({
        type: 'response.create',
        response: {
          conversation: 'none', // a one-off reply: not added to the call's history
          input: [...context, ...itemsBeingTranslated.map((id) => ({ type: 'item_reference', id }))],
        },
      }),
    );
  }

  return { stop: () => pc.close() };
}
