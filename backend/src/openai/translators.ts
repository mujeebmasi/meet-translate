// The models a meeting can translate with, picked when the meeting is
// created:
//
// - gpt-realtime-2: OpenAI's voice-assistant model, told by our own prompt
//   to act as an interpreter (see interpreter-prompt.ts). Translates after
//   each pause. Because it takes instructions, it can be told how to handle
//   idioms, numbers and misheard words -- which the others can't.
// - gpt-realtime-translate: OpenAI's dedicated interpreter model. Translates
//   while the speaker is still talking, but accepts no instructions.
// - gemini-3.5-live-translate: Google's dedicated interpreter model (see
//   gemini.service.ts). Also translates while the speaker talks and takes no
//   instructions, but unlike OpenAI's can speak Telugu.
export const TRANSLATORS = [
  'gpt-realtime-2',
  'gpt-realtime-translate',
  'gemini-3.5-live-translate',
];

// Gemini by default: in our real calls it did best (translates as you talk,
// every direction). GPT-Realtime-2 was the default before.
export const DEFAULT_TRANSLATOR = 'gemini-3.5-live-translate';
