import { ServiceUnavailableException } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiService } from './openai.service';

// A fake OpenAI on localhost, so the test checks the real request this
// service sends without spending anything.
describe('OpenAiService', () => {
  let server: Server;
  let lastRequest: {
    url?: string;
    headers: Record<string, unknown>;
    body: any;
  };
  let reply: { status: number; body: unknown };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        lastRequest = {
          url: req.url,
          headers: req.headers,
          body: JSON.parse(raw),
        };
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.OPENAI_API_KEY = 'sk-test';
  });

  afterAll(() => {
    server.close();
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it('asks for an English translation session and returns only the short-lived secret', async () => {
    reply = { status: 200, body: { value: 'ek_123', expires_at: 1700000000 } };
    const result = await new OpenAiService().createTranslationSecret('42');

    expect(result).toEqual({ clientSecret: 'ek_123', expiresAt: 1700000000 });
    expect(lastRequest.url).toBe('/realtime/translations/client_secrets');
    expect(lastRequest.headers.authorization).toBe('Bearer sk-test');
    expect(lastRequest.headers['openai-safety-identifier']).not.toBe('42'); // hashed
    expect(lastRequest.body.session.model).toBe('gpt-realtime-translate');
    expect(lastRequest.body.session.audio.output.language).toBe('en');
  });

  it('also understands the secret nested as client_secret.value', async () => {
    reply = {
      status: 200,
      body: { client_secret: { value: 'ek_456', expires_at: 5 } },
    };
    const result = await new OpenAiService().createTranslationSecret('42');
    expect(result).toEqual({ clientSecret: 'ek_456', expiresAt: 5 });
  });

  it("passes on OpenAI's own error message", async () => {
    reply = {
      status: 429,
      body: { error: { message: 'You exceeded your current quota' } },
    };
    await expect(
      new OpenAiService().createTranslationSecret('42'),
    ).rejects.toThrow('OpenAI 429: You exceeded your current quota');
  });

  it('says clearly when no API key is set', async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(
        new OpenAiService().createTranslationSecret('42'),
      ).rejects.toThrow(ServiceUnavailableException);
    } finally {
      process.env.OPENAI_API_KEY = key;
    }
  });
});
