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
  socketId: string; // the speaker asking: their own voice gets translated

  @IsString()
  listenerSocketId: string; // who it's translated for (sets the language)
}
