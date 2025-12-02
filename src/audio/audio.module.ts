import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { MusicService } from './music.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [AudioController],
  providers: [AudioService, MusicService],
  exports: [AudioService, MusicService],
})
export class AudioModule { }


