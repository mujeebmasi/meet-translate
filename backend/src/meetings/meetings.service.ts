import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface Meeting {
  code: string;
  title: string;
}

// Meetings live in memory: a restart forgets them. Enough for a first
// version; a database comes later if meetings need to last.
@Injectable()
export class MeetingsService {
  private meetings = new Map<string, Meeting>();

  create(title: string): Meeting {
    // A random code for the invite link (/m/<code>), so links can't be guessed.
    const code = randomBytes(5).toString('hex');
    const meeting = {
      code,
      title: title.trim().slice(0, 80) || 'Untitled meeting',
    };
    this.meetings.set(code, meeting);
    return meeting;
  }

  find(code: string): Meeting {
    const meeting = this.meetings.get(code);
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }
}
