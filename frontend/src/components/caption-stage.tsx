'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

// The home page's hero: a small mock of a call that plays one sentence at a
// time. The speaker's own words appear in their script, then the listener's
// caption fills in word by word, the way it does in a real call.
// It is an illustration, not a recording: the real timings are further down.

const SCENES = [
  {
    speaker: 'Ravi',
    from: 'Hindi',
    listener: 'Anna',
    to: 'English',
    said: 'कल दोपहर साढ़े बारह बजे मीटिंग शुरू होगी',
    saidClass: 'font-script-hi',
    heard: 'The meeting starts tomorrow at half past twelve.',
  },
  {
    speaker: 'Lakshmi',
    from: 'Telugu',
    listener: 'Anna',
    to: 'English',
    said: 'నాకు రేపు ఉదయం సమయం ఉంది',
    saidClass: 'font-script-te',
    heard: 'I have time tomorrow morning.',
  },
  {
    speaker: 'Ravi',
    from: 'Hindi',
    listener: 'Lakshmi',
    to: 'Telugu',
    said: 'आप कब आएंगे?',
    saidClass: 'font-script-hi',
    heard: 'మీరు ఎప్పుడు వస్తారు?',
    heardClass: 'font-script-te',
  },
] as const;

const TICK_MS = 150;
const SPEAKING_TICKS = 14; // the speaker is talking
const CAPTION_START = 18; // the caption begins a beat after they stop
const HOLD_TICKS = 24; // the finished caption stays on screen

const BARS = [0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.85, 0.55, 0.95, 0.65, 0.45];

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function CaptionStage() {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
  const [scene, setScene] = useState(0);
  const [tick, setTick] = useState(0);

  const current = SCENES[scene];
  const heardWords = current.heard.split(' ');
  const lastTick = CAPTION_START + heardWords.length + HOLD_TICKS;

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  // Move to the next sentence once this one has been on screen long enough.
  // Done while rendering (React's pattern for state that follows other state).
  if (!reducedMotion && tick >= lastTick) {
    setScene((scene + 1) % SCENES.length);
    setTick(0);
  }

  // With reduced motion, show one finished sentence and don't move.
  const t = reducedMotion ? lastTick : tick;
  const speaking = !reducedMotion && t < SPEAKING_TICKS;
  const sawWords = Math.max(0, Math.min(heardWords.length, t - CAPTION_START));
  const heard = heardWords.slice(0, sawWords).join(' ');
  const heardClass = 'heardClass' in current ? current.heardClass : '';

  return (
    <figure
      role="img"
      aria-label={`Example: ${current.speaker} says a sentence in ${current.from} and ${current.listener} reads it in ${current.to}.`}
      className="w-full"
    >
      <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
        {/* The speaker */}
        <div className="flex min-h-56 flex-col justify-between rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-black">{current.speaker}</p>
            <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs text-neutral-600">speaks {current.from}</span>
          </div>
          <p
            className={`min-h-20 text-xl leading-relaxed text-black transition-opacity duration-300 ${current.saidClass} ${
              t >= 2 ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {current.said}
          </p>
          <div className="flex h-8 items-end gap-1">
            {BARS.map((height, i) => (
              <span
                key={i}
                className={`w-1.5 rounded-full bg-brand ${speaking ? 'wave-bar' : 'opacity-30'}`}
                style={{
                  height: speaking ? `${height * 100}%` : '12%',
                  animationDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>
        </div>

        {/* The listener */}
        <div className="flex min-h-56 flex-col justify-between rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-black">{current.listener}</p>
            <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs text-neutral-600">hears {current.to}</span>
          </div>
          <p className={`min-h-20 text-xl leading-relaxed text-brand ${heardClass}`}>
            {heard}
            {!reducedMotion && sawWords > 0 && sawWords < heardWords.length && (
              <span className="caret ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-brand" />
            )}
          </p>
          <p className={`text-xs text-neutral-500 transition-opacity duration-300 ${sawWords > 0 ? 'opacity-100' : 'opacity-0'}`}>
            Translated voice plays with the caption
          </p>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-neutral-600">An example of one sentence, not a recording. Real timings are below.</figcaption>
    </figure>
  );
}
