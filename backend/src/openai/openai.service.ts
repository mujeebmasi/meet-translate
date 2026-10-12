import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// The browser talks to OpenAI's translator directly (WebRTC: audio in,
// English audio + text out), so audio never passes through this server.
// But the browser must never see the real API key -- anyone could copy it
// from the page. So the server asks OpenAI for a short-lived "client
// secret" that only works for one translation session, and hands that out.
@Injectable()
export class OpenAiService {
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  // `listenerId` identifies the person the session is for. OpenAI asks for
  // a stable id per end user (hashed, so no personal data is sent) to
  // trace abuse to one user instead of blocking the whole account.
  async createTranslationSecret(
    listenerId: string,
  ): Promise<{ clientSecret: string; expiresAt: number }> {
    if (!this.isConfigured())
      throw new ServiceUnavailableException(
        'Translation is not set up on this server (OPENAI_API_KEY is missing).',
      );

    const baseUrl = process.env.OPENAI_BASE_URL || OPENAI_BASE_URL;
    const res = await fetch(`${baseUrl}/realtime/translations/client_secrets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': createHash('sha256')
          .update(listenerId)
          .digest('hex'),
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            input: {
              // Also send back the speaker's own words as text (Hindi or
              // Telugu script), shown under the English caption.
              transcription: { model: 'gpt-realtime-whisper' },
              // The source is a person on a laptop or phone mic, not a
              // close headset, as far as we can tell.
              noise_reduction: { type: 'far_field' },
            },
            output: { language: 'en' },
          },
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as SecretResponse;
    if (!res.ok)
      throw new ServiceUnavailableException(
        `OpenAI ${res.status}: ${data.error?.message ?? 'could not start translation'}`,
      );

    // OpenAI's docs show the secret both as `value` and as
    // `client_secret.value`; accept either.
    const clientSecret = data.value ?? data.client_secret?.value;
    if (!clientSecret)
      throw new ServiceUnavailableException('OpenAI sent no client secret');
    return {
      clientSecret,
      expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? 0,
    };
  }
}

interface SecretResponse {
  value?: string;
  expires_at?: number;
  client_secret?: { value?: string; expires_at?: number };
  error?: { message?: string };
}
