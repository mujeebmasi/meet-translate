import { PresenceService } from './presence.service';

const peer = (socketId: string, lang = 'en') => ({
  socketId,
  name: socketId,
  lang,
});

describe('PresenceService', () => {
  it('adds people to a call and finds them', () => {
    const presence = new PresenceService();
    presence.add('room1', peer('a'));
    expect(presence.get('room1', 'a')).toEqual(peer('a'));
    expect(presence.list('room1')).toEqual([peer('a')]);
  });

  it('keeps different calls separate', () => {
    const presence = new PresenceService();
    presence.add('room1', peer('a'));
    presence.add('room2', peer('b'));
    expect(presence.list('room1').map((p) => p.socketId)).toEqual(['a']);
    expect(presence.list('room2').map((p) => p.socketId)).toEqual(['b']);
  });

  it('removes people, and an unknown call is just empty', () => {
    const presence = new PresenceService();
    presence.add('room1', peer('a'));
    presence.remove('room1', 'a');
    expect(presence.list('room1')).toEqual([]);
    expect(presence.list('nope')).toEqual([]);
  });

  it("updates someone's language in place", () => {
    const presence = new PresenceService();
    presence.add('room1', peer('a', 'en'));
    presence.setLang('room1', 'a', 'hi');
    expect(presence.get('room1', 'a')?.lang).toBe('hi');
  });
});
