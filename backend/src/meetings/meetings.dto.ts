import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TRANSLATORS } from '../openai/translators';

export class CreateMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsIn(TRANSLATORS)
  translator?: string;
}

export class TranslationSessionDto {
  @IsString()
  socketId: string; // the English listener asking

  @IsString()
  speakerSocketId: string; // the Hindi/Telugu speaker to translate
}
