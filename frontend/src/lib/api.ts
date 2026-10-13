// One place for every call to the backend.

import type { Meeting } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100/api';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4100';

async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    // fetch only throws when the request never reached the server.
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? 'Something went wrong');
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export const api = {
  // Whether creating a meeting needs an access code (set on public servers).
  getConfig: (): Promise<{ accessCodeRequired: boolean }> => request('/config'),

  createMeeting: (title: string, translator: string, accessCode: string): Promise<Meeting> =>
    request('/meetings', {
      method: 'POST',
      body: JSON.stringify({ title, translator }),
      headers: { 'x-access-code': accessCode },
    }),

  getMeeting: (code: string): Promise<Meeting> => request(`/meetings/${code}`),

  // A short-lived key for one OpenAI translation session (the real API key
  // stays on the server). `socketId` proves I'm on this call; the speaker's
  // tells the server which language to set the translator up for.
  startTranslation: (
    code: string,
    socketId: string,
    speakerSocketId: string,
  ): Promise<{ translator: string; clientSecret: string }> =>
    request(`/meetings/${code}/translation-session`, {
      method: 'POST',
      body: JSON.stringify({ socketId, speakerSocketId }),
    }),
};
