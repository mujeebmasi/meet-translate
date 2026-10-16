'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DEMO_VIDEOS, drivePlayerUrl } from '@/lib/demo';

// A button that opens the demo video in a pop-up player on this page, so
// visitors never leave the site. Close with ✕, Escape, or a click outside.
// The pop-up is drawn straight into <body> (a portal), so it works even when
// the button sits inside a sentence or a form.
export function DemoVideoButton({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(0);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const video = DEMO_VIDEOS[chosen];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Demo video"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            {/* Clicks inside the player box shouldn't close it. */}
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {DEMO_VIDEOS.map((v, i) => (
                    <button
                      key={v.driveId}
                      type="button"
                      onClick={() => setChosen(i)}
                      aria-pressed={chosen === i}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        chosen === i
                          ? 'bg-brand text-white'
                          : 'border border-line bg-surface text-muted hover:text-body'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close the video"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-body hover:border-brand"
                >
                  ✕
                </button>
              </div>

              <div className="aspect-video overflow-hidden rounded-xl border border-line bg-black">
                {/* key: a new iframe per video, so switching starts the other one fresh. */}
                <iframe
                  key={video.driveId}
                  src={drivePlayerUrl(video.driveId)}
                  title={`Demo video: ${video.label}`}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  className="size-full"
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
