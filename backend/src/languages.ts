// Languages people can pick. The choice decides who gets translated, and
// into what: everyone hears the others in their own language.
//
// Just these three: OpenAI's models accept Hindi and Telugu as input but
// not Tamil or Kannada (checked Oct 2026).
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

export const TARGET_LANG = 'en'; // the default language for a new person

// Which "speaker > listener" directions are translated:
// - Hindi or Telugu into English, by either model;
// - every other pair (Hindi <-> Telugu, English -> Hindi or Telugu), by
//   gpt-realtime-2 only. Its target language comes from our prompt;
//   gpt-realtime-translate is only ever set up to speak English here (and
//   can't speak Telugu at all).
export function canTranslate(
  speakerLang: string,
  listenerLang: string,
  translator: string,
): boolean {
  if (speakerLang === listenerLang) return false;
  if (listenerLang === 'en') return true;
  return translator === 'gpt-realtime-2';
}
