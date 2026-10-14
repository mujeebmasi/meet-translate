'use client';

import { useEffect, useRef } from 'react';

type VideoTileProps = {
  stream: MediaStream | null;
  label: string;
  name: string; // its first letter is shown when there's no picture
  muted?: boolean; // your own tile: never play your own voice back
  mirror?: boolean; // your own camera, shown like a mirror
  videoOff?: boolean;
  notice?: string; // shown over the tile, e.g. still connecting
  talking?: boolean; // holding "Hold to talk": the tile is highlighted
};

// A <video> can't be given a stream through a prop -- it has to be set on
// the element directly, so this wraps that in one small component.
//
// Sound plays through its own <audio> element, not the <video>: a <video>
// doesn't start until a picture arrives, so someone with no camera frames
// would also be silent.
export function VideoTile({ stream, label, name, muted = false, mirror, videoOff, notice, talking }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  const noPicture = !stream || videoOff || stream.getVideoTracks().length === 0 || !!notice;

  return (
    // While they talk: a glowing border and a "Speaking" badge, so the
    // listener sees at a glance who has the floor.
    <div
      className={`relative min-h-40 overflow-hidden rounded-xl bg-black transition-shadow ${
        talking ? 'shadow-[0_0_0_3px_var(--color-brand),0_0_24px_var(--color-brand)]' : ''
      }`}
    >
      {talking && (
        <span className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white">
          <span className="size-2 animate-pulse rounded-full bg-white" />
          Speaking
        </span>
      )}
      <audio ref={audioRef} autoPlay muted={muted} />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''} ${noPicture ? 'invisible' : ''}`}
      />
      {noPicture && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-2xl font-semibold text-brand">
            {name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          {(notice || !stream) && (
            <span className="max-w-64 px-3 text-center text-xs text-muted">{notice ?? 'Connecting...'}</span>
          )}
        </div>
      )}
      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-page/75 px-2.5 py-0.5 text-xs">
        {label}
      </span>
    </div>
  );
}
