// What both OpenAI translators share: a second WebRTC connection, this time
// between my browser and OpenAI. The speaker's incoming audio track is sent
// as-is, the English voice comes back as an audio track, and OpenAI's
// events (text, errors) arrive on a data channel. No audio passes through
// our own server.

export interface CaptionLine {
  id: string;
  original: string; // what they said, in Hindi/Telugu script
  english: string;
  done: boolean; // false while words are still arriving
  usage?: unknown; // gpt-realtime-2 only: OpenAI's token counts for this line
  // gpt-realtime-2 only: how long after the speaker's pause was noticed the
  // English text, and then the English voice, started (milliseconds).
  timing?: { textMs?: number; voiceMs?: number };
}

export interface TranslatorOptions {
  source: MediaStreamTrack; // the speaker's voice, as received on the call
  clientSecret: string;
  onAudio: (english: MediaStream) => void;
  onLine: (line: CaptionLine) => void;
  onError: (message: string) => void;
}

// `url` is the model's WebRTC address; `onEvent` gets every event OpenAI sends.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI's events are plain JSON of many shapes
export async function connectToOpenAI(options: TranslatorOptions, url: string, onEvent: (event: any) => void) {
  const pc = new RTCPeerConnection();
  pc.addTrack(options.source, new MediaStream([options.source]));
  pc.ontrack = (event) => options.onAudio(event.streams[0] ?? new MediaStream([event.track]));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') options.onError('Lost the connection to the translator.');
  };
  const events = pc.createDataChannel('oai-events');
  events.onmessage = ({ data }) => onEvent(JSON.parse(data));

  // Send our offer to OpenAI, get its answer back.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  });
  if (!response.ok) {
    pc.close();
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  // Closing `pc` ends the session, and OpenAI stops billing.
  return { pc, events };
}
