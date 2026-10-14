// One live translation of my voice for one listener, by whichever model
// the meeting was created with (see the backend's translators.ts for how
// they differ).

import { startGemini } from './gemini-session';
import { startRealtime2 } from './realtime2-session';
import { startTranslate } from './translate-session';
import type { TranslatorOptions } from './openai-connection';

export type { CaptionLine } from './openai-connection';

export function startTranslator(translator: string, options: TranslatorOptions): Promise<{ stop: () => void }> {
  if (translator === 'gpt-realtime-2') return startRealtime2(options);
  if (translator === 'gemini-3.5-live-translate') return startGemini(options);
  return startTranslate(options);
}
