export interface Meeting {
  code: string;
  title: string;
  translator: string; // which OpenAI model translates, see TRANSLATORS
}

// A person on the call, as the server announces them. Their socket id is
// their id: WebRTC messages are addressed to it.
export interface Peer {
  socketId: string;
  name: string;
  lang: string;
  translateOn?: boolean; // their "Translate to ..." switch (on unless said otherwise)
}

// Same three as the backend's languages.ts. OpenAI's models accept Hindi
// and Telugu (not Tamil or Kannada).
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

// Who hears whom translated -- same rule as the backend's languages.ts:
// into English with every model; every other pair (Hindi <-> Telugu,
// English -> Hindi/Telugu) with every model except GPT-Realtime-Translate.
export function canTranslate(speakerLang: string, listenerLang: string, translator: string): boolean {
  if (speakerLang === listenerLang) return false;
  if (listenerLang === 'en') return true;
  return translator !== 'gpt-realtime-translate';
}

// The models a meeting can use (the backend's translators.ts explains the
// difference). Picked when creating the meeting.
export const TRANSLATORS: Record<string, { name: string; about: string }> = {
  'gpt-realtime-2': {
    name: 'GPT-Realtime-2',
    about: 'Follows our interpreter instructions. Translates after each pause.',
  },
  'gpt-realtime-translate': {
    name: 'GPT-Realtime-Translate',
    about: 'Translates while the speaker is still talking. Takes no instructions.',
  },
  'gemini-3.5-live-translate': {
    name: 'Gemini Live Translate',
    about: "Google's model. Translates while the speaker is still talking, in every direction. Takes no instructions.",
  },
};
