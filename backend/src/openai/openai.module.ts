import { Global, Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';

@Global()
@Module({
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
