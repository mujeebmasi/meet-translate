// Translating with gpt-realtime-translate: OpenAI's dedicated interpreter
// model. English comes back as speech and text while the speaker is still
// talking, as one continuous stream (no sentences, no turns).

import { connectToOpenAI, type TranslatorOptions } from './openai-connection';
import { continuousCaptions } from './continuous-captions';

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/translations/calls';

export async function startTranslate(options: TranslatorOptions): Promise<{ stop: () => void }> {
  const captions = continuousCaptions(options.onLine);

  const { pc } = await connectToOpenAI(options, OPENAI_CALLS_URL, (event) => {
    if (event.type === 'session.output_transcript.delta') captions.addTranslation(event.delta);
    else if (event.type === 'session.input_transcript.delta') captions.addOriginal(event.delta);
    else if (event.type === 'error') options.onError(event.error?.message ?? 'Translator error');
  });

  return {
    stop: () => {
      captions.stop();
      pc.close();
    },
  };
}
