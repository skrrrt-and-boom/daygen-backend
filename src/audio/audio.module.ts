import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { MusicService } from './music.service';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, AuthModule, UploadModule, PrismaModule],
  controllers: [AudioController],
  providers: [AudioService, MusicService],
  exports: [AudioService, MusicService],
})
export class AudioModule { }


