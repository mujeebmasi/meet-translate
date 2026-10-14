'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

// The home page: what the app does, how fast and how well, and a button to
// /start (create or join a call).

// From our own test calls (see the README's Results section). Times count
// from the moment the speaker stops talking.
const STATS = [
  { value: '~1 s', label: 'Caption appears', detail: 'after the speaker stops' },
  { value: '~1.4 s', label: 'Translated voice starts', detail: 'after the speaker stops' },
  { value: '₹0.3–0.5', label: 'Per sentence', detail: 'silence costs nothing' },
  { value: '17 / 18', label: 'Lines right in real calls', detail: 'Hindi → English, Telugu → Hindi' },
];

const STEPS = [
  { title: 'You speak', text: 'Your browser sends your own microphone straight to OpenAI.' },
  {
    title: 'It interprets each sentence',
    text: 'GPT-Realtime-2 translates when you pause: it never answers for you, and keeps names and numbers exact.',
  },
  { title: 'They hear you in their language', text: 'The translated voice replaces yours on the call, with captions.' },
];

const DIRECTIONS = ['Hindi ↔ English', 'Telugu ↔ English', 'Hindi ↔ Telugu'];

export default function HomePage() {
  // Start waking the free server (it sleeps when unused, and takes up to a
  // minute to start) while the visitor reads, so the next page is ready.
  useEffect(() => {
    api.getConfig().catch(() => {});
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-4 py-14">
      <section className="text-center">
        <p className="mb-4 inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
          Live interpretation · powered by OpenAI GPT-Realtime-2
        </p>
        <h1 className="text-5xl font-semibold sm:text-6xl">
          Meet <em className="text-brand not-italic">Translate</em>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
          Video calls where you speak your language and they hear theirs: a translated voice and live captions,
          sentence by sentence.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {DIRECTIONS.map((direction) => (
            <span key={direction} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
              {direction}
            </span>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-line bg-surface p-5">
            <p className="text-2xl font-semibold whitespace-nowrap text-body sm:text-3xl">{stat.value}</p>
            <p className="mt-2 text-sm font-medium text-body">{stat.label}</p>
            <p className="text-xs text-muted">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-4 text-center text-sm font-semibold tracking-wide text-muted uppercase">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-line bg-surface p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-medium text-body">{step.title}</p>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col items-center gap-3 text-center">
        <Link
          href="/start"
          className="rounded-xl bg-brand px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Let&apos;s Get Started →
        </Link>
        <p className="max-w-xl text-xs text-muted">
          Numbers from our own test calls on laptop mics. The translator waits for the end of each sentence, so a
          longer sentence means a longer wait before it starts.
        </p>
      </section>
    </main>
  );
}
