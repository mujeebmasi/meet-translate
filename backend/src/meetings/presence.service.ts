import { Injectable } from '@nestjs/common';

// A person currently on a call. `socketId` (their live connection) doubles
// as their id: it's what WebRTC messages are addressed to.
export interface Peer {
  socketId: string;
  name: string;
  lang: string;
  // Whether they want to hear others translated (their "Translate to ..."
  // switch). The speakers' browsers read it to know whether to translate.
  translateOn?: boolean;
  // Push to talk: whether they're holding "Hold to talk" right now.
  talking?: boolean;
}

// Who is on each call right now, in memory. Nothing is kept once people
// leave -- there's no database in this version.
@Injectable()
export class PresenceService {
  private rooms = new Map<string, Map<string, Peer>>();

  add(meetingCode: string, peer: Peer): void {
    if (!this.rooms.has(meetingCode)) this.rooms.set(meetingCode, new Map());
    this.rooms.get(meetingCode)!.set(peer.socketId, peer);
  }

  remove(meetingCode: string, socketId: string): void {
    const room = this.rooms.get(meetingCode);
    room?.delete(socketId);
    // Forget a call once its last person leaves.
    if (room?.size === 0) this.rooms.delete(meetingCode);
  }

  get(meetingCode: string, socketId: string): Peer | undefined {
    return this.rooms.get(meetingCode)?.get(socketId);
  }

  list(meetingCode: string): Peer[] {
    return [...(this.rooms.get(meetingCode)?.values() ?? [])];
  }

  setLang(meetingCode: string, socketId: string, lang: string): void {
    const peer = this.get(meetingCode, socketId);
    if (peer) peer.lang = lang;
  }

  setTranslateOn(meetingCode: string, socketId: string, on: boolean): void {
    const peer = this.get(meetingCode, socketId);
    if (peer) peer.translateOn = on;
  }

  // Push to talk, one person at a time: starting fails (false) while
  // someone else in the call is talking. Stopping always works.
  setTalking(meetingCode: string, socketId: string, on: boolean): boolean {
    const peer = this.get(meetingCode, socketId);
    if (!peer) return false;
    const someoneElse = this.list(meetingCode).some(
      (p) => p.talking && p.socketId !== socketId,
    );
    if (on && someoneElse) return false;
    peer.talking = on;
    return true;
  }
}
