'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { TRANSLATORS } from '@/lib/types';
import { Button, ErrorText, Label } from '@/components/ui';

// A short tag on each translator option, to make the choice obvious.
const TAGS: Record<string, string> = {
  'gpt-realtime-2': 'Recommended',
  'gpt-realtime-translate': 'Fastest start',
  'gemini-3.5-live-translate': 'Experimental',
};

// /start -- create a meeting, or join one with a code or link. The home
// page (/) explains the app and links here.
export default function StartPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'start' | 'join'>('start');
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

  function switchTo(next: 'start' | 'join') {
    setMode(next);
    setError('');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted hover:text-brand">
          ← Back
        </Link>
        <span className="text-sm font-semibold">
          Meet <em className="text-brand not-italic">Translate</em>
        </span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold">{mode === 'start' ? 'Start a call' : 'Join a call'}</h1>
        <p className="mt-1 text-muted">
          {mode === 'start'
            ? 'Create a meeting, then send the invite link to the other person.'
            : 'Paste the invite link or code someone sent you.'}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-black/40 sm:p-6">
        {/* Start / Join switch */}
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-raised p-1 text-sm font-medium">
          {(['start', 'join'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => switchTo(option)}
              className={`rounded-lg py-2 transition-colors ${
                mode === option ? 'bg-brand text-white' : 'text-muted hover:text-body'
              }`}
            >
              {option === 'start' ? 'Start a call' : 'Join a call'}
            </button>
          ))}
        </div>

        {mode === 'start' ? (
          <form onSubmit={createMeeting} className="flex flex-col gap-5">
            <div>
              <Label>Meeting name</Label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Interview with Priya" maxLength={80} />
            </div>

            <fieldset>
              <Label>Translator</Label>
              <div className="grid gap-2">
                {Object.entries(TRANSLATORS).map(([id, t]) => {
                  const chosen = translator === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTranslator(id)}
                      aria-pressed={chosen}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                        chosen ? 'border-brand bg-brand-soft' : 'border-line bg-raised hover:border-brand/60'
                      }`}
                    >
                      <span
                        className={`mt-1 size-4 shrink-0 rounded-full border-2 ${
                          chosen ? 'border-brand bg-brand shadow-[inset_0_0_0_2px_var(--color-surface)]' : 'border-muted'
                        }`}
                      />
                      <span className="flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-body">{t.name}</span>
                          {TAGS[id] && (
                            <span className="rounded-full bg-page/60 px-2 py-0.5 text-[11px] text-muted">{TAGS[id]}</span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">{t.about}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {needsCode && (
              <div>
                <Label>Access code</Label>
                {/* Hidden like a password: it's what stops strangers using
                    the OpenAI key, and screens get shared. */}
                <input
                  type="password"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Ask the owner of this site"
                  autoComplete="off"
                  required
                />
                <p className="mt-1 text-xs text-muted">Only needed to start a call. Joining needs just the link.</p>
              </div>
            )}

            <Button type="submit" disabled={creating || !serverReady} className="py-3 text-base">
              {!serverReady ? 'Waking the server up...' : creating ? 'Creating...' : 'Create meeting →'}
            </Button>
          </form>
        ) : (
          <form onSubmit={joinMeeting} className="flex flex-col gap-5">
            <div>
              <Label>Meeting code or invite link</Label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste it here" required />
              <p className="mt-1 text-xs text-muted">No access code needed to join.</p>
            </div>
            <Button type="submit" className="py-3 text-base">
              Join meeting →
            </Button>
          </form>
        )}

        {error && (
          <div className="mt-4">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        Calls are one-to-one. Use headphones if you&apos;re both in the same room.
      </p>
    </main>
  );
}
