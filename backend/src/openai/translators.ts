// The two OpenAI models a meeting can translate with, picked when the
// meeting is created:
//
// - gpt-realtime-2: OpenAI's voice-assistant model, told by our own prompt
//   to act as an interpreter (see interpreter-prompt.ts). Translates after
//   each pause. Because it takes instructions, it can be told how to handle
//   idioms, numbers and misheard words -- which the other model can't.
// - gpt-realtime-translate: OpenAI's dedicated interpreter model. Translates
//   while the speaker is still talking, but accepts no instructions.
export const TRANSLATORS = ['gpt-realtime-2', 'gpt-realtime-translate'];
export const DEFAULT_TRANSLATOR = 'gpt-realtime-2';
