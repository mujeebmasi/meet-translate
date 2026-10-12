// Languages people can pick. OpenAI's translator works out the spoken
// language by itself; the choice here only decides who gets translated.
//
// Just these three: OpenAI's model accepts Hindi and Telugu as input but
// not Tamil or Kannada (its input list, checked Oct 2026), and English is
// the only language we translate into.
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

// Translation only ever goes one way: into English.
export const TARGET_LANG = 'en';

// An English listener hears a speaker translated only if the speaker isn't
// speaking English themselves.
export function needsTranslation(
  speakerLang: string,
  listenerLang: string,
): boolean {
  return speakerLang !== TARGET_LANG && listenerLang === TARGET_LANG;
}
