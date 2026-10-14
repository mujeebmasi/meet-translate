// Translating with Google's Gemini 3.5 Live Translate. Like
// gpt-realtime-translate, it translates while the speaker is still talking
// and takes no instructions -- but it can speak Telugu, so it covers every
// direction.
//
// Unlike OpenAI (WebRTC: an audio track in, an audio track out), Gemini
// only speaks WebSocket with raw audio samples. So this file does the audio
// work WebRTC did for us:
// - my mic -> 16 kHz 16-bit samples -> base64 -> Gemini, every 100 ms;
// - Gemini's 24 kHz samples -> played one after another into an audio
//   track, which replaces my voice on the call.

import type { TranslatorOptions } from './openai-connection';
import { continuousCaptions } from './continuous-captions';

// The token from our server is locked to this model and to the listener's
// language, so the setup here only has to name the model.
const MODEL = 'models/gemini-3.5-live-translate-preview';
const GEMINI_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

const IN_RATE = 16000; // what Gemini wants to hear
const OUT_RATE = 24000; // what Gemini speaks
const CHUNK = IN_RATE / 10; // 100 ms of samples per message, as Google suggests

// How far the translated voice may run behind before silent pieces are
// skipped (see play()). A little slack keeps playback smooth.
const MAX_BEHIND_S = 0.2;
const SILENCE_LEVEL = 0.005; // average loudness below this counts as silence

function isSilent(samples: Float32Array): boolean {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length) < SILENCE_LEVEL;
}

// Runs on the browser's audio thread and hands every block of mic samples
// (128 at a time) to this file. Written inline so there's no extra file to
// serve.
const CAPTURE_WORKLET = `
registerProcessor('capture', class extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0][0];
    if (samples) this.port.postMessage(samples.slice(0));
    return true;
  }
});`;

export async function startGemini(options: TranslatorOptions): Promise<{ stop: () => void }> {
  const captions = continuousCaptions(options.onLine);
  let stopped = false;

  // --- the translated voice: an audio track to put on the call ---
  const output = new AudioContext({ sampleRate: OUT_RATE });
  void output.resume();
  const voice = output.createMediaStreamDestination();
  options.onAudio(voice.stream);
  let playAt = 0; // when the next piece starts, so pieces play back to back
  const play = (base64: string) => {
    const samples = int16ToFloat(base64ToInt16(base64));
    // Gemini streams non-stop, silence included (about 60% of what it sends
    // in a test). Played back to back, every late network piece pushed all
    // later ones back for good -- in a real call the voice ended up 8-10 s
    // behind. So while we're behind, silent pieces are skipped: the delay
    // drains away at every pause, and no speech is ever dropped.
    const behind = playAt - output.currentTime;
    if (behind > MAX_BEHIND_S && isSilent(samples)) return;
    const buffer = output.createBuffer(1, samples.length, OUT_RATE);
    buffer.copyToChannel(samples, 0);
    const source = output.createBufferSource();
    source.buffer = buffer;
    source.connect(voice);
    playAt = Math.max(playAt, output.currentTime);
    source.start(playAt);
    playAt += buffer.duration;
  };

  // --- the connection to Gemini ---
  const ws = new WebSocket(`${GEMINI_WS_URL}?access_token=${options.clientSecret}`);
  ws.binaryType = 'arraybuffer'; // Gemini sends its JSON as binary frames
  let ready = false; // Gemini has accepted the setup; audio may be sent
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        setup: {
          model: MODEL,
          generationConfig: { responseModalities: ['AUDIO'] },
          inputAudioTranscription: {}, // my words as text
          outputAudioTranscription: {}, // the translation as text
        },
      }),
    );
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    if (message.setupComplete) ready = true;
    const content = message.serverContent;
    if (!content) return;
    if (content.inputTranscription?.text) captions.addOriginal(content.inputTranscription.text);
    if (content.outputTranscription?.text) captions.addTranslation(content.outputTranscription.text);
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) play(part.inlineData.data);
    }
  };
  ws.onclose = (event) => {
    // Google ends sessions after a while, or on a bad token: say so, the
    // speaker can switch translation off and on to start a new one.
    if (!stopped) options.onError(`Gemini closed the translation${event.reason ? `: ${event.reason}` : ''}.`);
  };

  // --- my mic, to Gemini ---
  // An AudioContext running at 16 kHz converts the mic's sample rate itself.
  const input = new AudioContext({ sampleRate: IN_RATE });
  void input.resume();
  const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
  await input.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const capture = new AudioWorkletNode(input, 'capture');
  input.createMediaStreamSource(new MediaStream([options.source])).connect(capture);

  let pending: Float32Array[] = [];
  let pendingLength = 0;
  capture.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    pending.push(data);
    pendingLength += data.length;
    if (pendingLength < CHUNK) return;
    const chunk = new Float32Array(pendingLength);
    let offset = 0;
    for (const block of pending) {
      chunk.set(block, offset);
      offset += block.length;
    }
    pending = [];
    pendingLength = 0;
    if (ready && ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: int16ToBase64(floatToInt16(chunk)), mimeType: `audio/pcm;rate=${IN_RATE}` } },
        }),
      );
  };

  return {
    stop: () => {
      stopped = true;
      captions.stop();
      ws.close(); // ends the session (and the billing)
      void input.close();
      void output.close();
    },
  };
}

// --- converting audio samples ---
// Web Audio uses numbers from -1 to 1; Gemini uses 16-bit whole numbers
// (-32768 to 32767), sent as base64 text inside JSON.

function floatToInt16(samples: Float32Array): Int16Array {
  const result = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

function int16ToFloat(samples: Int16Array): Float32Array<ArrayBuffer> {
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) result[i] = samples[i] / 0x8000;
  return result;
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
