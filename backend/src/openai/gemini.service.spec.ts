import { ServiceUnavailableException } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GeminiService } from './gemini.service';

// A fake Google on localhost, so the test checks the real request this
// service sends without spending anything.
describe('GeminiService', () => {
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
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.GEMINI_API_KEY = 'AIza-test';
  });

  afterAll(() => {
    server.close();
    delete process.env.GEMINI_BASE_URL;
    delete process.env.GEMINI_API_KEY;
  });

  it('asks for a one-use token locked to translating into the listener language', async () => {
    reply = {
      status: 200,
      body: { name: 'auth_tokens/abc', expireTime: '2026-10-14T12:30:00Z' },
    };
    const result = await new GeminiService().createSession('te');

    expect(result).toEqual({
      translator: 'gemini-3.5-live-translate',
      clientSecret: 'auth_tokens/abc',
      expiresAt: Date.parse('2026-10-14T12:30:00Z') / 1000,
    });
    expect(lastRequest.url).toBe('/auth_tokens');
    expect(lastRequest.headers['x-goog-api-key']).toBe('AIza-test');
    expect(lastRequest.body.uses).toBe(1);
    const setup = lastRequest.body.bidiGenerateContentSetup;
    expect(setup.model).toBe('models/gemini-3.5-live-translate-preview');
    expect(setup.generationConfig.translationConfig).toEqual({
      targetLanguageCode: 'te',
    });
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
  });

  it("passes on Google's own error message", async () => {
    reply = { status: 403, body: { error: { message: 'API key not valid' } } };
    await expect(new GeminiService().createSession('en')).rejects.toThrow(
      'Gemini 403: API key not valid',
    );
  });

  it('says clearly when no API key is set', async () => {
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await expect(new GeminiService().createSession('en')).rejects.toThrow(
        ServiceUnavailableException,
      );
    } finally {
      process.env.GEMINI_API_KEY = key;
    }
  });
});
