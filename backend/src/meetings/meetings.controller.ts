import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { PresenceService } from './presence.service';
import { CreateMeetingDto, TranslationSessionDto } from './meetings.dto';
import { OpenAiService } from '../openai/openai.service';
import { canTranslate } from '../languages';
import { checkAccessCode } from '../access-code';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private meetings: MeetingsService,
    private presence: PresenceService,
    private openai: OpenAiService,
  ) {}

  // Needs the access code (header x-access-code) when the server has one.
  @Post()
  create(
    @Body() dto: CreateMeetingDto,
    @Headers('x-access-code') accessCode?: string,
  ) {
    checkAccessCode(accessCode);
    return this.meetings.create(dto.title ?? '', dto.translator);
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.meetings.find(code);
  }

  // A speaker's browser asks for this to have its own voice translated for
  // a listener, then connects to OpenAI itself with the short-lived secret
  // it gets back (see OpenAiService for why). The speaker translates, not
  // the listener: their own mic is clean, and doesn't first have to cross
  // the call's (sometimes slow, relayed) connection -- which made a real
  // call much slower. Only for two people on this call, in a direction
  // this meeting's model can translate -- otherwise anyone could use this
  // server to translate on our bill.
  @Post(':code/translation-session')
  translationSession(
    @Param('code') code: string,
    @Body() dto: TranslationSessionDto,
  ) {
    const meeting = this.meetings.find(code);
    const speaker = this.presence.get(code, dto.socketId);
    const listener = this.presence.get(code, dto.listenerSocketId);
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
      `${code}:${speaker.socketId}`,
    );
  }
}
