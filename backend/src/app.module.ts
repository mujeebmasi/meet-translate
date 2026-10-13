import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAiModule } from './openai/openai.module';
import { MeetingsModule } from './meetings/meetings.module';
import { ConfigController } from './config.controller';

@Module({
  imports: [
    // Loads the .env file and makes process.env available everywhere.
    ConfigModule.forRoot({ isGlobal: true }),
    OpenAiModule,
    MeetingsModule,
  ],
  controllers: [ConfigController],
})
export class AppModule {}
