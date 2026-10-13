// Translating with gpt-realtime-2 -- OpenAI's voice-assistant model, told
// by our server's prompt to act as an interpreter (see the backend's
// interpreter-prompt.ts).
//
// Unlike gpt-realtime-translate it works turn by turn: our pause detector
// (pause-detector.ts) notices each pause in the speaker's voice and tells
// OpenAI to save what came before it as one "item"; we then ask for a
// reply, which is the translation. Replies are asked for one at a time,
// and the next only once the last has been fully made AND fully heard, so
// a new sentence never cuts off the translation of the one before.
//
// Each reply is given ONLY the new speech to translate (plus the last few
// translations as text, marked as already said). Given the whole call, the
// model answered unclear speech or a "hmm" by repeating its last
// translation -- with nothing to repeat, it can't.

import {
  connectToOpenAI,
  type CaptionLine,
  type TranslatorOptions,
} from "./openai-connection";
import { watchForPauses } from "./pause-detector";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// If the speaker's own words (transcribed separately) haven't arrived this
// long after the translation is finished, show the line without waiting.
const TRANSCRIPT_WAIT_MS = 3000;

// How many earlier translations each reply is shown, to understand what's
// being talked about.
const CONTEXT_LINES = 3;

// A pause that held only a filler sound: "hmm", "umm", "hun", a short
// laugh. Asking for a translation of these made the model repeat its last
// one, so they're skipped. Checked word by word, after dropping the
// nasal/half-letter marks, so "ह्म्म" and "हुं" match too. "हाँ" ("yes")
// is not a filler and is still translated.
const FILLER_WORD =
  /^(h+m+|m+|u+m+|u+h+|a+h+|hu+n|ह[ुू]?म*|उ+म*|अ+|హ[ుూ]?మ*|ఉ+మ*|అ+)$/;
export function isFiller(transcript: string): boolean {
  const words = transcript
    .toLowerCase()
    .replace(/[्ँंఁం్]/g, "") // virama, anusvara, chandrabindu
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.every((word) => FILLER_WORD.test(word)); // also true for no words at all
}

export async function startRealtime2(
  options: TranslatorOptions,
): Promise<{ stop: () => void }> {
  // Each caption line is one reply: the translation, plus the speaker's
  // words from every item it translated (usually one; two if they spoke
  // again while the last reply was still playing).
  const lines = new Map<string, CaptionLine>(); // reply id -> its line
  const itemsOf = new Map<CaptionLine, string[]>();
  const spoken = new Map<string, { text: string; complete: boolean }>(); // item id -> speaker's words
  const finished: CaptionLine[] = []; // for the earlier-translations context
  // Items in the order they were said, each waiting for the filler check.
  const checking: { id: string; verdict?: "translate" | "skip" }[] = [];
  let notYetTranslated: string[] = []; // passed the check, waiting for a reply
  let itemsBeingTranslated: string[] = [];
  let replying = false; // a reply is being made or still being heard
  let replyWanted = false;
  // The reply in progress: finished once OpenAI has made it AND its voice
  // has finished playing (or it had nothing to say).
  let current = { id: "", made: false, heard: false };
  const withVoice = new Set<string>(); // replies whose voice started playing
  // A reply's voice should end with output_audio_buffer.stopped; if that
  // never comes, don't let the call get stuck waiting for it.
  const STUCK_REPLY_MS = 30_000;
  let stuckTimer: ReturnType<typeof setTimeout> | undefined;
  // When the speaker's last pause was noticed -- the clock for each line's
  // timing. (Noticed 0.5s after they actually stop: the length of quiet
  // the pause detector waits for.)
  let pauseNoticedAt = 0;
  let lastSpokeMs = 0;
  const spokeMs = new Map<string, number>(); // item id -> how long they talked
  const startedAt = new Map<CaptionLine, number>();

  const show = (line: CaptionLine) => options.onLine({ ...line });
  const refreshOriginal = (line: CaptionLine) => {
    line.original = (itemsOf.get(line) ?? [])
      .map((id) => spoken.get(id)?.text ?? "")
      .join(" ")
      .trim();
  };
  // A line is finished once the translation is done and the speaker's own
  // words have arrived (they're transcribed separately, sometimes later).
  const finishIfReady = (
    line: CaptionLine,
    translationDone: boolean,
    force = false,
  ) => {
    const wordsReady = (itemsOf.get(line) ?? []).every(
      (id) => spoken.get(id)?.complete,
    );
    if (translationDone && (wordsReady || force) && !line.done) {
      line.done = true;
      show(line);
    }
  };
  const translationDone = new Set<CaptionLine>();

  // --- the filler check ---
  // Translate straight away, unless the transcript has already come in and
  // is only a filler. Waiting for it to arrive cost up to 0.6s a sentence;
  // a filler that slips through costs little now, because each reply sees
  // only the new speech (and the prompt says to stay silent on fillers).
  function check(id: string) {
    checking.push({ id });
    const soFar = spoken.get(id)?.text ?? "";
    decide(id, soFar && isFiller(soFar) ? "skip" : "translate");
  }
  function decide(id: string, verdict: "translate" | "skip") {
    const entry = checking.find((c) => c.id === id);
    if (!entry || entry.verdict) return; // already decided
    entry.verdict = verdict;
    // Release decided items in the order they were said.
    while (checking[0]?.verdict) {
      const next = checking.shift()!;
      if (next.verdict === "translate") notYetTranslated.push(next.id);
    }
    askForReply();
  }

  const { pc, events } = await connectToOpenAI(
    options,
    OPENAI_CALLS_URL,
    (event) => {
      switch (event.type) {
        // After our "commit": what they said up to the pause is now one item.
        case "input_audio_buffer.committed":
          spokeMs.set(event.item_id, lastSpokeMs);
          check(event.item_id);
          break;

        case "response.created": {
          const line: CaptionLine = {
            id: crypto.randomUUID(),
            original: "",
            english: "",
            done: false,
          };
          current = { id: event.response.id, made: false, heard: false };
          lines.set(event.response.id, line);
          startedAt.set(line, pauseNoticedAt);
          itemsOf.set(line, itemsBeingTranslated);
          line.timing = {
            spokeMs: itemsBeingTranslated.reduce(
              (sum, id) => sum + (spokeMs.get(id) ?? 0),
              0,
            ),
          };
          refreshOriginal(line);
          break;
        }

        case "response.output_audio_transcript.delta": {
          const line = lines.get(event.response_id);
          if (!line) break;
          if (!line.english)
            line.timing = {
              ...line.timing,
              textMs: Date.now() - startedAt.get(line)!,
            };
          line.english += event.delta;
          show(line);
          break;
        }

        // The translated voice actually starts playing (sent over WebRTC only).
        case "output_audio_buffer.started": {
          withVoice.add(event.response_id);
          const line = lines.get(event.response_id);
          if (line && line.timing?.voiceMs === undefined)
            line.timing = {
              ...line.timing,
              voiceMs: Date.now() - startedAt.get(line)!,
            };
          break;
        }

        // Its voice has finished playing (or was cut off).
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          if (event.response_id === current.id) {
            current.heard = true;
            if (current.made) replyHeard();
          }
          break;

        case "response.done": {
          const line = lines.get(event.response.id);
          // "done" means the reply is fully made, not fully heard: its voice
          // is usually still playing. A reply with no voice (nothing to say)
          // is heard already.
          if (event.response.id === current.id) {
            current.made = true;
            if (current.heard || !withVoice.has(event.response.id))
              replyHeard();
          }
          if (!line) break;
          line.usage = event.response.usage;
          translationDone.add(line);
          if (line.english.trim()) finished.push(line);
          finishIfReady(line, true);
          setTimeout(() => finishIfReady(line, true, true), TRANSCRIPT_WAIT_MS);
          break;
        }

        // The speaker's own words, transcribed separately from the translation.
        case "conversation.item.input_audio_transcription.delta":
        case "conversation.item.input_audio_transcription.completed": {
          const done = event.type.endsWith("completed");
          const before = spoken.get(event.item_id)?.text ?? "";
          const text = done ? event.transcript : before + event.delta;
          spoken.set(event.item_id, { text, complete: done });
          if (done)
            decide(event.item_id, isFiller(text) ? "skip" : "translate");
          for (const line of itemsOf.keys()) {
            if (!itemsOf.get(line)!.includes(event.item_id)) continue;
            refreshOriginal(line);
            show(line);
            finishIfReady(line, translationDone.has(line));
          }
          break;
        }

        case "error":
          replyHeard(); // a failed reply mustn't block the ones after it
          options.onError(event.error?.message ?? "Translator error");
          break;
      }
    },
  );

  function replyHeard() {
    clearTimeout(stuckTimer);
    replying = false;
    if (replyWanted) askForReply();
  }

  function askForReply() {
    if (replying) {
      replyWanted = true;
      return;
    }
    if (notYetTranslated.length === 0) return;
    replying = true;
    replyWanted = false;
    stuckTimer = setTimeout(replyHeard, STUCK_REPLY_MS);
    itemsBeingTranslated = notYetTranslated;
    notYetTranslated = [];

    // The reply sees only this: the earlier translations as text (to
    // understand what's being talked about) and the new speech.
    const earlier = finished
      .slice(-CONTEXT_LINES)
      .map((line) => `- ${line.english.trim()}`);
    const context = earlier.length
      ? [
          {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `Earlier in this call, already translated -- only to help you understand. Never say any of it again:\n${earlier.join("\n")}`,
              },
            ],
          },
        ]
      : [];
    // The same rule as in the prompt, repeated right after the new speech:
    // models follow what they read last most closely. Without it, a
    // question that came after a few statements ("Did you talk to the
    // client?") got answered -- "Yeah, I spoke with the client" -- instead
    // of translated.
    const reminder = {
      type: "message",
      role: "system",
      content: [
        {
          type: "input_text",
          text: "Interpret only the speech just above, as the interpreter. A question stays a question: translate it, never answer it. Never reply as yourself.",
        },
      ],
    };
    send({
      type: "response.create",
      response: {
        // `input` gives this reply its own context (only the new speech),
        // instead of the whole call. It's still a normal reply, though, not
        // an "out-of-band" one (conversation: 'none'): OpenAI cut those off
        // the moment the speaker started their next sentence, because the
        // session's "don't interrupt" setting only covers normal replies.
        input: [
          ...context,
          ...itemsBeingTranslated.map((id) => ({ type: "item_reference", id })),
          reminder,
        ],
      },
    });
  }

  function send(event: object) {
    if (events.readyState === "open") events.send(JSON.stringify(event));
  }

  // --- our own pause detection (OpenAI's is switched off on the server) ---
  const pauses = watchForPauses(options.source, {
    onPause: (ms) => {
      pauseNoticedAt = Date.now();
      lastSpokeMs = ms;
      send({ type: "input_audio_buffer.commit" });
    },
    // OpenAI keeps everything it hears until a commit, silence included.
    // While nobody is talking, drop it, so an item is the sentence (plus at
    // most ~2s of quiet before it) -- not every silent minute since the
    // last one, which would all be paid for.
    onQuiet: () => send({ type: "input_audio_buffer.clear" }),
  });

  return {
    stop: () => {
      clearTimeout(stuckTimer);
      pauses.stop();
      pc.close();
    },
  };
}
