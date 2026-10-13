import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';
import { CreateMeetingDto, TranslationSessionDto } from './meetings.dto';
import { OpenAiService } from '../openai/openai.service';
import { canTranslate } from '../languages';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private openai: OpenAiService,
  ) {}

  @Post()
  create(@Body() dto: CreateMeetingDto) {
    return this.meetings.create(dto.title ?? '', dto.translator);
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.meetings.find(code);
  }

  // A listener's browser asks for this for each speaker it wants to hear in
  // its own language, then connects to OpenAI itself with the short-lived
  // secret it gets back (see OpenAiService for why). Only for two people on
  // this call, in a direction this meeting's model can translate --
  // otherwise anyone could use this server to translate on our bill.
  @Post(':code/translation-session')
  translationSession(
    @Param('code') code: string,
    @Body() dto: TranslationSessionDto,
  ) {
    const meeting = this.meetings.find(code);
    const listener = this.presence.get(code, dto.socketId);
    const speaker = this.presence.get(code, dto.speakerSocketId);
    if (
      !listener ||
      !speaker ||
      !canTranslate(speaker.lang, listener.lang, meeting.translator)
    )
      throw new ForbiddenException(
        "This meeting can't translate between these two people's languages",
      );
    return this.openai.createSession(
      meeting.translator,
      speaker.lang,
      listener.lang,
      `${code}:${listener.socketId}`,
    );
  }
}
