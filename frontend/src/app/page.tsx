'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { DemoVideoButton } from '@/components/demo-video';

// The home page: what the app does, how fast and how well, and a button to
// /start (create or join a call).

// From our own test calls (see the README's Results section), one row per
// model, the default (Gemini) first. GPT-Realtime-2 waits for the end of
// each sentence, so its times count from when the speaker stops; Gemini
// translates while they talk.
const MODEL_STATS = [
  {
    model: 'Gemini 3.5 Live Translate',
    note: 'translates while you talk',
    stats: [
      // Timing notes from real calls: 2.4-4.6 s after the speaker starts.
      { value: '~3.5 s', label: 'Translated voice starts', detail: 'after the speaker starts, while they talk' },
      // Natural speech in real calls, all directions together (see README).
      { value: '30 / 37', label: 'Lines right in real calls', detail: 'natural speech, all directions' },
      { value: '~₹3', label: 'Per minute', detail: "Google's price, silence included" },
      { value: '6 / 6', label: 'Directions', detail: 'incl. into Telugu, which OpenAI can’t speak' },
    ],
  },
  {
    model: 'GPT-Realtime-2',
    note: 'translates after each sentence',
    stats: [
      { value: '~1 s', label: 'Caption appears', detail: 'after the speaker stops' },
      { value: '~1.4 s', label: 'Translated voice starts', detail: 'after the speaker stops' },
      { value: '₹0.3–0.5', label: 'Per sentence', detail: 'silence costs nothing' },
      { value: '17 / 18', label: 'Lines right in real calls', detail: 'Hindi → English, Telugu → Hindi' },
    ],
  },
];

const STEPS = [
  { title: 'You speak', text: 'Your browser sends your own microphone straight to the translator, Google or OpenAI.' },
  {
    title: 'It interprets',
    text: 'Gemini Live Translate translates while you are still talking. GPT-Realtime-2 translates each sentence when you pause, keeping names and numbers exact.',
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
          Live interpretation · Google Gemini or OpenAI GPT-Realtime-2
        </p>
        <h1 className="text-5xl font-semibold sm:text-6xl">
          Meet <em className="text-brand not-italic">Translate</em>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
          Video calls where you speak your language and they hear theirs: a translated voice and live captions.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {DIRECTIONS.map((direction) => (
            <span key={direction} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
              {direction}
            </span>
          ))}
        </div>
        <DemoVideoButton className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-body transition-colors hover:border-brand hover:text-brand">
          ▶ Watch the demo video
        </DemoVideoButton>
        <p className="mt-2 text-xs text-muted">A real recorded call, seen from each side.</p>
      </section>

      {MODEL_STATS.map((row) => (
        <section key={row.model}>
          <h2 className="mb-3 text-sm font-semibold text-body">
            {row.model} <span className="font-normal text-muted">· {row.note}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {row.stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-line bg-surface p-5">
                <p className="text-2xl font-semibold whitespace-nowrap text-body sm:text-3xl">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-body">{stat.label}</p>
                <p className="text-xs text-muted">{stat.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

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
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/start"
            className="rounded-xl bg-brand px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Let&apos;s Get Started →
          </Link>
          <DemoVideoButton className="rounded-xl border border-line bg-surface px-8 py-3 text-base font-semibold text-body transition-colors hover:border-brand hover:text-brand">
            ▶ Watch the demo
          </DemoVideoButton>
        </div>
        <p className="max-w-xl text-xs text-muted">
          Numbers from our own test calls on laptop mics. GPT-Realtime-2 waits for the end of each sentence, so a
          longer sentence means a longer wait. Gemini starts while you are still talking.
        </p>
      </section>
    </main>
  );
}
