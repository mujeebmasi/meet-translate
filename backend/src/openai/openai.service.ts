import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LANGUAGES } from '../languages';
import { interpreterPrompt } from './interpreter-prompt';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// The browser talks to OpenAI directly (WebRTC: audio in, English audio +
// text out), so audio never passes through this server. But the browser
// must never see the real API key -- anyone could copy it from the page.
// So the server asks OpenAI for a short-lived "client secret" that only
// works for one session, and hands that out.
@Injectable()
export class OpenAiService {
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  // `speakerLang` is the language of the person being translated,
  // `listenerLang` the one they're translated into.
  // `listenerId` identifies the person the session is for: OpenAI asks for
  // a stable id per end user (hashed, so no personal data is sent) to
  // trace abuse to one user instead of blocking the whole account.
  async createSession(
    translator: string,
    speakerLang: string,
    listenerLang: string,
    listenerId: string,
  ): Promise<{ translator: string; clientSecret: string; expiresAt: number }> {
    if (!this.isConfigured())
      throw new ServiceUnavailableException(
        'Translation is not set up on this server (OPENAI_API_KEY is missing).',
      );

    // The two models live at different addresses and take different settings.
    const path =
      translator === 'gpt-realtime-2'
        ? '/realtime/client_secrets'
        : '/realtime/translations/client_secrets';
    const session =
      translator === 'gpt-realtime-2'
        ? realtime2Session(speakerLang, listenerLang)
        : translateSession();

    const baseUrl = process.env.OPENAI_BASE_URL || OPENAI_BASE_URL;
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': createHash('sha256')
          .update(listenerId)
          .digest('hex'),
      },
      body: JSON.stringify({ session }),
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
      translator,
      clientSecret,
      expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? 0,
    };
  }
}

// gpt-realtime-2, told by our prompt to interpret. It waits for a pause,
// then speaks the translation (and sends it as text too).
function realtime2Session(speakerLang: string, listenerLang: string) {
  return {
    type: 'realtime',
    model: 'gpt-realtime-2',
    instructions: interpreterPrompt(
      LANGUAGES[speakerLang] ?? 'Hindi',
      LANGUAGES[listenerLang] ?? 'English',
    ),
    // It can "think" before replying; for translating one sentence that's
    // mostly delay.
    reasoning: { effort: 'minimal' },
    output_modalities: ['audio'],
    audio: {
      input: {
        // The speaker's own words as text, shown under the English. Told
        // the language: in the first test, a Telugu word came out in Hindi
        // script.
        transcription: { model: 'gpt-realtime-whisper', language: speakerLang },
        noise_reduction: { type: 'far_field' },
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 600, // this much quiet ends a sentence
          // Replies are started by the browser instead (one at a time, see
          // realtime2-session.ts), so a new sentence never cuts off the
          // English of the one before.
          create_response: false,
          interrupt_response: false,
        },
      },
      // A male voice (OpenAI's 'marin' is female).
      output: { voice: 'cedar' },
    },
  };
}

// gpt-realtime-translate: a dedicated interpreter, translating while the
// speaker talks. It accepts no instructions, only the target language.
function translateSession() {
  return {
    model: 'gpt-realtime-translate',
    audio: {
      input: {
        transcription: { model: 'gpt-realtime-whisper' },
        noise_reduction: { type: 'far_field' },
      },
      output: { language: 'en' },
    },
  };
}

interface SecretResponse {
  value?: string;
  expires_at?: number;
  client_secret?: { value?: string; expires_at?: number };
  error?: { message?: string };
}
