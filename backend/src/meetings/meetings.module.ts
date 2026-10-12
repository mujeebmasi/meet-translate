import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingsGateway } from './meetings.gateway';
import { PresenceService } from './presence.service';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsGateway, PresenceService],
})
export class MeetingsModule {}
