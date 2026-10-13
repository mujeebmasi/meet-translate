import { NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';

describe('MeetingsService', () => {
  it('creates a meeting with a random code and finds it again', () => {
    const meetings = new MeetingsService();
    const meeting = meetings.create('  Interview  ');
    expect(meeting.code).toMatch(/^[0-9a-f]{10}$/);
    expect(meetings.find(meeting.code)).toEqual({
      code: meeting.code,
      title: 'Interview',
      translator: 'gpt-realtime-2',
    });
  });

  it('names an untitled meeting', () => {
    expect(new MeetingsService().create('').title).toBe('Untitled meeting');
  });

  it('keeps the chosen translator, and ignores an unknown one', () => {
    const meetings = new MeetingsService();
    expect(meetings.create('a', 'gpt-realtime-translate').translator).toBe(
      'gpt-realtime-translate',
    );
    expect(meetings.create('b', 'gpt-9').translator).toBe('gpt-realtime-2');
  });

  it('says when a code does not exist', () => {
    expect(() => new MeetingsService().find('nope')).toThrow(NotFoundException);
  });
});
