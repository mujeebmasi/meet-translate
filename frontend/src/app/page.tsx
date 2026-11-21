'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Languages, Mic, Play, Video, Volume2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DEMO_VIDEOS, drivePlayerUrl } from '@/lib/demo';
import { CaptionStage } from '@/components/caption-stage';

// The home page: what the app does, how fast and how well, and a button to
// /start (create or join a call).

// From our own test calls (see the README's Results section), one column per
// model, the default (Gemini) first. GPT-Realtime-2 waits for the end of
// each sentence, so its times count from when the speaker stops; Gemini
// translates while they talk.
const MODEL_STATS = [
  {
    model: 'Gemini 3.5 Live Translate',
    note: 'Translates while you talk. The default.',
    stats: [
      // Timing notes from real calls: 2.4-4.6 s after the speaker starts.
      { value: '~3.5 s', label: 'Translated voice starts', detail: 'after the speaker starts, while they talk' },
      // Natural speech in real calls, all directions together (see README).
      { value: '30 of 37', label: 'Lines right in real calls', detail: 'natural speech, all directions' },
      { value: '~₹3', label: 'Cost per minute', detail: "Google's price, silence included" },
      { value: '6 of 6', label: 'Directions', detail: 'including into Telugu, which OpenAI can’t speak' },
    ],
  },
  {
    model: 'GPT-Realtime-2',
    note: 'Translates after each sentence. Takes instructions.',
    stats: [
      { value: '~1 s', label: 'Caption appears', detail: 'after the speaker stops' },
      { value: '~1.4 s', label: 'Translated voice starts', detail: 'after the speaker stops' },
      { value: '₹0.3–0.5', label: 'Cost per sentence', detail: 'silence costs nothing' },
      { value: '17 of 18', label: 'Lines right in real calls', detail: 'Hindi → English, Telugu → Hindi' },
    ],
  },
];

const STEPS = [
  { icon: Mic, title: 'You speak', text: 'Your browser sends your own microphone straight to the translator, Google or OpenAI.' },
  {
    icon: Languages,
    title: 'It interprets',
    text: 'Gemini Live Translate translates while you are still talking. GPT-Realtime-2 translates each sentence when you pause, keeping names and numbers exact.',
  },
  { icon: Volume2, title: 'They hear you in their language', text: 'The translated voice replaces yours on the call, with captions.' },
];

export default function HomePage() {
  // Start waking the free server (it sleeps when unused, and takes up to a
  // minute to start) while the visitor reads, so the next page is ready.
  useEffect(() => {
    api.getConfig().catch(() => {});
  }, []);

  return (
    <div className="bg-white text-black">
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-14 px-5 py-16 sm:px-8 lg:py-20">
      {/* The hero: the promise on the left, the product doing it on the right. */}
      <section className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            Speak your language. They hear theirs.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-neutral-600">
            Video calls in Hindi, Telugu and English with a translated voice and live captions, in every direction.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/start"
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              <Video className="size-4" aria-hidden="true" />
              Start a call
            </Link>
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 px-6 py-3 text-base font-medium text-black transition-colors hover:border-brand"
            >
              <Play className="size-4" aria-hidden="true" />
              Watch the demo
            </a>
          </div>
          <p className="mt-6 text-sm text-neutral-600">Hindi, Telugu and English · powered by Google Gemini or OpenAI</p>
        </div>
        <CaptionStage />
      </section>

      {/* The numbers, as two columns so the two translators can be read side by side. */}
      <section>
        <h2 className="font-display text-3xl font-semibold tracking-tight">Two translators. Pick one per call.</h2>
        <p className="mt-2 max-w-xl text-neutral-600">Numbers from our own test calls on laptop microphones.</p>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          {MODEL_STATS.map((row) => (
            <div key={row.model} className="border-t border-neutral-200 pt-5">
              <h3 className="text-lg font-semibold text-black">{row.model}</h3>
              <p className="mt-1 text-sm text-neutral-600">{row.note}</p>
              <dl className="mt-5 divide-y divide-neutral-200">
                {row.stats.map((stat) => (
                  <div key={stat.label} className="flex items-baseline justify-between gap-4 py-3">
                    <div>
                      <dt className="text-sm font-medium text-black">{stat.label}</dt>
                      <dd className="text-xs text-neutral-600">{stat.detail}</dd>
                    </div>
                    <p className="font-display text-2xl font-semibold whitespace-nowrap text-black">{stat.value}</p>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-xs text-neutral-600">
          GPT-Realtime-2 waits for the end of each sentence, so a longer sentence means a longer wait. Gemini starts
          while you are still talking.
        </p>
      </section>

      {/* The demo call, playable right here (Drive's embeddable player shows
          each video's first frame with a play button). Linked from /start as
          /#demo for visitors without an access code. */}
      <section id="demo" className="scroll-mt-8">
        <h2 className="font-display text-3xl font-semibold tracking-tight">Watch a real call</h2>
        <p className="mt-2 max-w-xl text-neutral-600">The same call, filmed from each side.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {DEMO_VIDEOS.map((video) => (
            <figure key={video.driveId} className="overflow-hidden rounded-2xl bg-black">
              <div className="aspect-video bg-black">
                <iframe
                  src={drivePlayerUrl(video.driveId)}
                  title={`Demo video: ${video.label}`}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  loading="lazy"
                  className="size-full"
                />
              </div>
              <figcaption className="px-4 py-3 text-sm font-medium text-white">{video.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-3xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t border-neutral-200 pt-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <step.icon className="size-5" aria-hidden="true" />
                </span>
                <p className="font-display text-sm font-semibold text-brand">Step {i + 1}</p>
              </div>
              <p className="mt-2 text-lg font-semibold text-black">{step.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col items-start gap-4 border-t border-neutral-200 pt-12">
        <h2 className="font-display text-3xl font-semibold tracking-tight">Try it on a real call</h2>
        <p className="max-w-xl text-neutral-600">Pick a translator, share the invite link, and talk.</p>
        <Link
          href="/start"
          className="rounded-xl bg-brand px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Start a call
        </Link>
      </section>
    </main>
    </div>
  );
}
