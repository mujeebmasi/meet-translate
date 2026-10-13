// gpt-realtime-2 is billed per token, and every reply also re-reads the
// call so far (mostly at the cheap "cached" rate). The browser passes on
// OpenAI's token counts for each translated sentence, and this turns them
// into dollars for the server log -- so a test call shows what it cost.
//
// Prices per 1M tokens, from OpenAI's gpt-realtime-2 page (Oct 2026).
const PRICE_PER_MILLION = {
  textIn: 4,
  audioIn: 32,
  cachedIn: 0.4,
  textOut: 24,
  audioOut: 64,
};

// The shape of `usage` in OpenAI's response.done event (only the parts used).
export interface RealtimeUsage {
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export function estimateCostUsd(usage: RealtimeUsage): number {
  const input = usage.input_token_details ?? {};
  const output = usage.output_token_details ?? {};
  // Cached tokens are counted inside the text/audio totals; charge them
  // once, at the cached rate. (Assumes they're audio first: most of a
  // call is audio, and it's the pricier way to be wrong.)
  const cached = input.cached_tokens ?? 0;
  const audioIn = Math.max(0, (input.audio_tokens ?? 0) - cached);
  const textIn = Math.max(
    0,
    (input.text_tokens ?? 0) - Math.max(0, cached - (input.audio_tokens ?? 0)),
  );
  const dollars =
    textIn * PRICE_PER_MILLION.textIn +
    audioIn * PRICE_PER_MILLION.audioIn +
    cached * PRICE_PER_MILLION.cachedIn +
    (output.text_tokens ?? 0) * PRICE_PER_MILLION.textOut +
    (output.audio_tokens ?? 0) * PRICE_PER_MILLION.audioOut;
  return dollars / 1_000_000;
}
