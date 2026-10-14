import { Global, Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { GeminiService } from './gemini.service';

@Global()
@Module({
  providers: [OpenAiService, GeminiService],
  exports: [OpenAiService, GeminiService],
})
export class OpenAiModule {}
