export interface Meeting {
  code: string;
  title: string;
}

// A person on the call, as the server announces them. Their socket id is
// their id: WebRTC messages are addressed to it.
export interface Peer {
  socketId: string;
  name: string;
  lang: string;
}

// Same three as the backend's languages.ts. OpenAI's translator accepts
// Hindi and Telugu (not Tamil or Kannada), and we translate into English.
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

export const TARGET_LANG = 'en';
