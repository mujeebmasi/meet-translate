'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { TRANSLATORS } from '@/lib/types';
import { Button, Card, ErrorText, Label } from '@/components/ui';

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [translator, setTranslator] = useState('gpt-realtime-2');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // A public server asks for an access code before creating a meeting (so
  // a stranger with the link can't run up the OpenAI bill). Remembered in
  // this browser after the first time.
  const [needsCode, setNeedsCode] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [accessCode, setAccessCode] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('omt:access-code') || '',
  );

  // Also wakes the server up: on a free host it sleeps when unused, and the
  // first request after that can take up to a minute.
  useEffect(() => {
    api
      .getConfig()
      .then((config) => setNeedsCode(config.accessCodeRequired))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setServerReady(true));
  }, []);

  async function createMeeting(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const meeting = await api.createMeeting(title, translator, accessCode.trim());
      localStorage.setItem('omt:access-code', accessCode.trim());
      router.push(`/m/${meeting.code}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  function joinMeeting(e: FormEvent) {
    e.preventDefault();
    // Accept either the bare code or the whole invite link.
    const joinCode = code.trim().split('/').pop();
    if (joinCode) router.push(`/m/${joinCode}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-4xl font-semibold">
        Meet <em className="text-brand not-italic">Translate</em>
      </h1>
      <p className="mb-4 text-muted">
        Video calls where Hindi and Telugu speakers are heard in English, with live captions. Powered by OpenAI&apos;s
        realtime voice models.
      </p>

      <Card>
        <form onSubmit={createMeeting} className="flex flex-col gap-3">
          <div>
            <Label>Meeting name</Label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Interview with Priya" maxLength={80} />
          </div>
          <div>
            <Label>Translator</Label>
            <select value={translator} onChange={(e) => setTranslator(e.target.value)}>
              {Object.entries(TRANSLATORS).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{TRANSLATORS[translator].about}</p>
          </div>
          {needsCode && (
            <div>
              <Label>Access code</Label>
              <input
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Ask the owner of this site"
                required
              />
            </div>
          )}
          <Button type="submit" disabled={creating || !serverReady}>
            {!serverReady ? 'Waking the server up...' : creating ? 'Creating...' : 'Create meeting'}
          </Button>
        </form>
      </Card>

      <Card>
        <form onSubmit={joinMeeting} className="flex flex-col gap-3">
          <div>
            <Label>Have a code or link?</Label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste meeting code" required />
          </div>
          <Button type="submit" variant="quiet">
            Join
          </Button>
        </form>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}
    </main>
  );
}
