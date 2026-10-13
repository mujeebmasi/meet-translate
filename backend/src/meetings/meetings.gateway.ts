import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { LANGUAGES, TARGET_LANG } from '../languages';
import { MeetingsService, type Meeting } from './meetings.service';
import { PresenceService } from './presence.service';
import { iceServers } from './ice-servers';
import { estimateCostUsd, type RealtimeUsage } from '../openai/cost';

// Video and audio go straight between browsers (WebRTC). Before they can,
// the browsers must swap connection details, and this gateway is the
// go-between -- it passes "signal" messages along without reading them.

// One-to-one calls only: one person speaking Hindi/Telugu, one listening in
// English. Keeps the call simple, and the cost at one translation at a time.
const MAX_PEOPLE = 2;

interface JoinMessage {
  code: string;
  name: string;
  lang: string;
}

// The meeting this connection joined. socket.io's client.data is untyped,
// so it's read through this one helper.
function meetingCodeOf(client: Socket): string | undefined {
  return (client.data as { code?: string }).code;
}

@Injectable()
@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: (process.env.FRONTEND_URL ?? 'http://localhost:3100').split(','),
  },
})
export class MeetingsGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger('Captions');

  @WebSocketServer()
  server: Server;

  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
  ) {}

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinMessage,
  ): void {
    if (meetingCodeOf(client)) return; // already joined on this connection

    let meeting: Meeting;
    try {
      meeting = this.meetings.find(body.code);
    } catch {
      client.disconnect(true);
      return;
    }

    const others = this.presence.list(body.code);
    if (others.length >= MAX_PEOPLE) {
      client.emit('full');
      client.disconnect(true);
      return;
    }

    const peer = {
      socketId: client.id,
      name:
        String(body.name || '')
          .trim()
          .slice(0, 40) || 'Guest',
      lang: LANGUAGES[body.lang] ? body.lang : TARGET_LANG,
    };
    void client.join(body.code); // socket.io "room", for broadcasting to the call
    (client.data as { code?: string }).code = body.code;
    this.presence.add(body.code, peer);

    client.emit('welcome', {
      you: client.id,
      title: meeting.title,
      translator: meeting.translator,
      peers: others,
      iceServers: iceServers(),
    });
    client.to(body.code).emit('peer-joined', { peer });
  }

  // `to` is another person's socket id. Only passed on if they're in the
  // sender's own meeting, so nobody can reach people in other meetings.
  @SubscribeMessage('signal')
  handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { to: string; data: unknown },
  ): void {
    const code = meetingCodeOf(client);
    if (!code || !this.presence.get(code, body.to)) return;
    this.server
      .to(body.to)
      .emit('signal', { from: client.id, data: body.data });
  }

  @SubscribeMessage('set-lang')
  handleSetLang(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lang: string },
  ): void {
    const code = meetingCodeOf(client);
    if (!code || !LANGUAGES[body.lang]) return;
    this.presence.setLang(code, client.id, body.lang);
    this.server
      .to(code)
      .emit('peer-updated', { peer: this.presence.get(code, client.id) });
  }

  // Each finished caption line, from the English listener's browser, is
  // written to the server log: what was said and what it became. Handy for
  // checking a test call afterwards. Nothing is stored.
  @SubscribeMessage('caption')
  handleCaption(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      speaker: string;
      original: string;
      english: string;
      usage?: RealtimeUsage; // gpt-realtime-2 only: OpenAI's token counts
      // gpt-realtime-2 only: ms after the speaker's pause was noticed that
      // the English text / voice started.
      timing?: { textMs?: number; voiceMs?: number };
    },
  ): void {
    const code = meetingCodeOf(client);
    const speaker = code && this.presence.get(code, body?.speaker);
    if (!speaker) return;
    const said = String(body.original ?? '').slice(0, 500);
    const english = String(body.english ?? '').slice(0, 500);
    const cost = body.usage
      ? `  (~$${estimateCostUsd(body.usage).toFixed(4)})`
      : '';
    const seconds = (ms?: number) =>
      typeof ms === 'number' ? `${(ms / 1000).toFixed(2)}s` : '?';
    const timing = body.timing
      ? `
    After the pause: text ${seconds(body.timing.textMs)}, voice ${seconds(body.timing.voiceMs)}`
      : '';
    this.logger.log(`${speaker.name} said: ${said}
    Translation: ${english}${cost}${timing}`);
  }

  handleDisconnect(client: Socket): void {
    const code = meetingCodeOf(client);
    if (!code) return;
    this.presence.remove(code, client.id);
    client.to(code).emit('peer-left', { socketId: client.id });
  }
}
