// Finds the pauses in a speaker's voice, in the listener's browser, so we
// can tell OpenAI "that sentence is finished, translate it".
//
// Why not OpenAI's own pause detection: whenever it heard the speaker start
// talking again, it cut off the translation that was still playing (in a
// real call, the second sentence cut off the first one's translation). With
// our own, OpenAI never decides when to interrupt -- nothing gets cut off.
//
// It's a simple loudness check, 20 times a second: speech is sound clearly
// louder than this speaker's background noise.

const CHECK_EVERY_MS = 50;
const PAUSE_MS = 500; // this much quiet ends a sentence
const MIN_SPEECH_MS = 400; // shorter than this is a click, a bump or a breath, not speech
const MAX_SPEECH_MS = 15_000; // translate long monologues in pieces, not at the very end
// Never treat sound quieter than this as speech. Kept low: a soft voice on a
// laptop mic arrives quiet, and the first version (0.01) missed some real
// speakers entirely -- so nothing was ever translated.
const MIN_LEVEL = 0.003;
const ABOVE_BACKGROUND = 3; // speech = 3x louder than the background
const QUIET_REPORT_MS = 2000; // see onQuiet

interface PauseDetectorOptions {
  onPause: (spokeMs: number) => void; // a sentence just ended
  onQuiet: () => void; // called every 2s while nobody's talking
}

export function watchForPauses(track: MediaStreamTrack, options: PauseDetectorOptions): { stop: () => void } {
  const audio = new AudioContext();
  // Browsers may keep audio processing paused until the page is clicked
  // (Brave especially) -- and then this would hear only silence. Try now,
  // and again on any click or key press.
  const wakeUp = () => void audio.resume();
  wakeUp();
  window.addEventListener('pointerdown', wakeUp);
  window.addEventListener('keydown', wakeUp);

  const analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  audio.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  // The background noise level, learned ALL the time, not only between
  // sentences: it follows the sound down quickly and up slowly (over ~10s).
  // Speech has tiny gaps between syllables, so this settles on the noise
  // floor. (Learning it only "while quiet" broke on a line with steady
  // noise: it took the noise for speech from the start, never learned
  // otherwise, and never saw a pause.)
  let background = MIN_LEVEL / ABOVE_BACKGROUND;
  let speaking = false;
  let speechStartedAt = 0;
  let lastLoudAt = 0;
  let lastQuietReportAt = Date.now();

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const level = Math.sqrt(sum / samples.length);
    const now = Date.now();

    background = level < background ? background * 0.7 + level * 0.3 : background * 0.995 + level * 0.005;
    const loud = level > Math.max(MIN_LEVEL, background * ABOVE_BACKGROUND);

    if (!speaking) {
      if (loud) {
        speaking = true;
        speechStartedAt = now;
        lastLoudAt = now;
      } else if (now - lastQuietReportAt >= QUIET_REPORT_MS) {
        lastQuietReportAt = now;
        options.onQuiet();
      }
      return;
    }

    if (loud) lastLoudAt = now;
    const spokeMs = lastLoudAt - speechStartedAt;
    if (now - lastLoudAt >= PAUSE_MS) {
      speaking = false;
      lastQuietReportAt = now;
      if (spokeMs >= MIN_SPEECH_MS) options.onPause(spokeMs);
    } else if (now - speechStartedAt >= MAX_SPEECH_MS) {
      options.onPause(now - speechStartedAt);
      speechStartedAt = now; // keep going: the rest is the next piece
    }
  }, CHECK_EVERY_MS);

  return {
    stop: () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', wakeUp);
      window.removeEventListener('keydown', wakeUp);
      void audio.close();
    },
  };
}
