import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_MODEL = 'models/gemini-3.5-live-translate-preview';

// Google's Gemini 3.5 Live Translate, the same way as OpenAI's models: the
// browser talks to Google directly (a WebSocket, see the frontend's
// gemini-session.ts), and the real API key stays here. This server asks
// Google for a short-lived "ephemeral token" for one session and hands that
// out. The token is locked to our model and settings -- including the
// language to translate into -- so it can't be used for anything else.
@Injectable()
export class GeminiService {
  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  // `listenerLang` is the language the speaker is translated into. The
  // speaker's own language isn't needed: the model detects it.
  async createSession(
    listenerLang: string,
  ): Promise<{ translator: string; clientSecret: string; expiresAt: number }> {
    if (!this.isConfigured())
      throw new ServiceUnavailableException(
        'Gemini translation is not set up on this server (GEMINI_API_KEY is missing).',
      );

    const now = Date.now();
    const baseUrl = process.env.GEMINI_BASE_URL || GEMINI_BASE_URL;
    const res = await fetch(`${baseUrl}/auth_tokens`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uses: 1, // one session
        expireTime: new Date(now + 30 * 60_000).toISOString(), // the session can last 30 min
        newSessionExpireTime: new Date(now + 60_000).toISOString(), // must start within 1 min
        // The session settings the token is locked to. Google's docs show
        // this as `liveConnectConstraints` (the SDK's name), but the REST
        // API itself only accepts `bidiGenerateContentSetup` -- what the
        // SDK turns it into.
        bidiGenerateContentSetup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            // echoTargetLanguage off (the default): if the speaker already
            // talks the listener's language, say nothing.
            translationConfig: { targetLanguageCode: listenerLang },
          },
          inputAudioTranscription: {}, // the speaker's words as text
          outputAudioTranscription: {}, // the translation as text
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok)
      throw new ServiceUnavailableException(
        `Gemini ${res.status}: ${data.error?.message ?? 'could not start translation'}`,
      );
    // The token is the `name` field ("auth_tokens/...").
    if (!data.name)
      throw new ServiceUnavailableException('Gemini sent no token');
    return {
      translator: 'gemini-3.5-live-translate',
      clientSecret: data.name,
      expiresAt: Math.floor(Date.parse(data.expireTime ?? '') / 1000) || 0,
    };
  }
}

interface TokenResponse {
  name?: string;
  expireTime?: string;
  error?: { message?: string };
}
