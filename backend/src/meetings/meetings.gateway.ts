import { Injectable } from '@nestjs/common';
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

// Video and audio go straight between browsers (WebRTC). Before they can,
// the browsers must swap connection details, and this gateway is the
// go-between -- it passes "signal" messages along without reading them.

// Every person connects to every other person, so it gets heavy past a
// handful of people.
const MAX_PEOPLE = 6;

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

  handleDisconnect(client: Socket): void {
    const code = meetingCodeOf(client);
    if (!code) return;
    this.presence.remove(code, client.id);
    client.to(code).emit('peer-left', { socketId: client.id });
  }
}
