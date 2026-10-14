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

// One-to-one calls only (e.g. one person speaking Hindi/Telugu, one
// listening in English). Keeps the call simple, and the cost low.
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
      translateOn: true,
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

  // A listener switched "Translate to ..." on or off. The speakers' browsers
  // do the translating, so they're told, like with a language change.
  @SubscribeMessage('set-translate')
  handleSetTranslate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { on: boolean },
  ): void {
    const code = meetingCodeOf(client);
    if (!code) return;
    this.presence.setTranslateOn(code, client.id, body?.on !== false);
    this.server
      .to(code)
      .emit('peer-updated', { peer: this.presence.get(code, client.id) });
  }

  // A caption line from a speaker's browser, which translates its own
  // voice: passed on to the listener it's for (again each time it grows).
  // Finished lines are also written to the server log -- what was said,
  // what it became, what it cost, how fast it was. Nothing is stored.
  @SubscribeMessage('caption')
  handleCaption(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      listener: string;
      id: string;
      original: string;
      english: string;
      done: boolean;
      usage?: RealtimeUsage; // gpt-realtime-2 only: OpenAI's token counts
      // gpt-realtime-2 only: ms after the speaker's pause was noticed that
      // the translated text / voice started, and how long they spoke.
      timing?: { textMs?: number; voiceMs?: number; spokeMs?: number };
    },
  ): void {
    const code = meetingCodeOf(client);
    const speaker = code && this.presence.get(code, client.id);
    const listener = code && this.presence.get(code, body?.listener);
    if (!speaker || !listener) return;
    const said = String(body.original ?? '').slice(0, 500);
    const english = String(body.english ?? '').slice(0, 500);
    this.server.to(listener.socketId).emit('caption', {
      id: `${speaker.socketId}:${String(body.id).slice(0, 60)}`,
      name: speaker.name,
      original: said,
      english,
      done: body.done === true,
      timing: body.timing,
    });
    if (body.done !== true) return;

    const cost = body.usage
      ? `  (~$${estimateCostUsd(body.usage).toFixed(4)})`
      : '';
    const seconds = (ms?: number) =>
      typeof ms === 'number' ? `${(ms / 1000).toFixed(2)}s` : '?';
    const timing = body.timing
      ? `\n    After the pause: text ${seconds(body.timing.textMs)}, voice ${seconds(body.timing.voiceMs)}`
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
