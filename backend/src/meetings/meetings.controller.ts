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
import { TARGET_LANG } from '../languages';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private openai: OpenAiService,
  ) {}

  @Post()
  create(@Body() dto: CreateMeetingDto) {
    return this.meetings.create(dto.title ?? '');
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.meetings.find(code);
  }

  // An English listener's browser asks for this once per Hindi/Telugu
  // speaker it wants to hear in English, then connects to OpenAI itself
  // with the short-lived secret it gets back (see OpenAiService for why).
  // Only someone actually on this call, listening in English, gets one --
  // otherwise anyone could use this server to translate on our bill.
  @Post(':code/translation-session')
  translationSession(
    @Param('code') code: string,
    @Body() dto: TranslationSessionDto,
  ) {
    const listener = this.presence.get(code, dto.socketId);
    if (!listener || listener.lang !== TARGET_LANG)
      throw new ForbiddenException(
        'Only English listeners on this call can start a translation',
      );
    return this.openai.createTranslationSecret(`${code}:${listener.socketId}`);
  }
}
