# Meet Translate (OpenAI)

Video calls where Hindi and Telugu speakers are heard in English **while
they are still talking**, with live English captions. Translation is done by
OpenAI's [`gpt-realtime-translate`](https://developers.openai.com/api/docs/guides/realtime-translation).

A simpler sibling of [Meet Translate](https://github.com/mujeebmasi/meeting-translate),
which builds the same thing from separate parts (local speech-to-text, an LLM
translator, a text-to-speech voice) and waits for each sentence to end.

## How it works

```mermaid
flowchart LR
    R["Ravi's browser<br/>(speaks Hindi)"] <-->|"video + voice<br/>(WebRTC, direct)"| A["Anna's browser<br/>(listens in English)"]
    A -->|"Ravi's voice"| O["OpenAI<br/>gpt-realtime-translate"]
    O -->|"English voice + captions"| A
    A -.->|"asks for a short-lived key"| S["Our server<br/>(NestJS)"]
    R -.->|"join, connection details"| S
```

1. **Video call:** browsers connect straight to each other (WebRTC). The
   server only introduces them (Socket.IO) and keeps the list of who is in
   which meeting, in memory.
2. **Translation:** an English listener's browser opens a second WebRTC
   connection, to OpenAI, and sends it the Hindi/Telugu speaker's voice as
   received on the call. English speech comes back as an audio track and
   the captions on a data channel.
3. **The API key stays on the server.** The browser asks our server for a
   short-lived key that works for one translation session only.
4. The speaker's own voice is turned down to 15%, not muted: the translator
   stays quiet for words already in English, and those should still be heard.

## Measured

A Hindi and a Telugu sentence (generated speech, played into the call as
the speaker's mic), with an English listener in a second window:

| | Hindi | Telugu |
|---|---|---|
| First English caption | 1.3 s after the speaker **started** | 1.3 s after the speaker **started** |
| Last English words | ~0.5 s after the speaker stopped | ~0.5 s after the speaker stopped |
| Result | "Hello, and welcome to today's meeting. We'll discuss the new project. Please send the report by tomorrow evening. Okay." | "Hello. In today's meeting, let's talk about the new project. Send the report by tomorrow." |

Both translations were correct. The English keeps pace with the speaker
instead of waiting for the sentence to end: Meet Translate shows its caption
about 1 s *after* a sentence ends.

## Languages

English, Hindi and Telugu. OpenAI's model accepts Hindi and Telugu as input
but not Tamil or Kannada.

## Cost

$0.034 a minute (about ₹3) for each English listener hearing each
Hindi/Telugu speaker, for as long as the call lasts, silence included. A
30-minute one-to-one call is about ₹90. Unticking **Translate to English**
stops it at once.

## Running it

Needs Node.js and an OpenAI API key with credit.

```bash
cd backend && cp .env.example .env   # then put your OPENAI_API_KEY in .env
npm install && npm run start:dev     # http://localhost:4100

cd frontend && npm install && npm run dev   # http://localhost:3100
```

Open http://localhost:3100, create a meeting, join as English in one window
and as Hindi in another (a different device, or headphones, to avoid echo).

Tests: `cd backend && npm test`.

## Not in this first version

Kept out on purpose, to start simple: a database (meetings are forgotten on
restart), saved transcripts, captions for the speaker, and an access code
or daily limit before putting it on a public link.
