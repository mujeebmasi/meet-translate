// One live translation of a remote speaker into English, by whichever
// OpenAI model the meeting was created with (see the backend's
// translators.ts for how the two differ).

import { startRealtime2 } from './realtime2-session';
import { startTranslate } from './translate-session';
import type { TranslatorOptions } from './openai-connection';

export type { CaptionLine } from './openai-connection';

export function startTranslator(translator: string, options: TranslatorOptions): Promise<{ stop: () => void }> {
  return translator === 'gpt-realtime-2' ? startRealtime2(options) : startTranslate(options);
}
