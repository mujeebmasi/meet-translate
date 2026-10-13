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
// - Hindi <-> Telugu, by gpt-realtime-2 only. Its target language comes
//   from our prompt; gpt-realtime-translate can't speak Telugu at all.
// English speakers aren't translated for Hindi/Telugu listeners: not part
// of this app.
const INTO_ENGLISH = ['hi>en', 'te>en'];
const BETWEEN_INDIAN = ['hi>te', 'te>hi'];

export function canTranslate(
  speakerLang: string,
  listenerLang: string,
  translator: string,
): boolean {
  const pair = `${speakerLang}>${listenerLang}`;
  if (INTO_ENGLISH.includes(pair)) return true;
  return translator === 'gpt-realtime-2' && BETWEEN_INDIAN.includes(pair);
}
