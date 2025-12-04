import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TimelineService } from './timeline.service';
import { AudioModule } from '../audio/audio.module';
import { UploadModule } from '../upload/upload.module';

import { TimelineController } from './timeline.controller';

import { PrismaModule } from '../prisma/prisma.module';

import { GenerationModule } from '../generation/generation.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [ConfigModule, AudioModule, UploadModule, PrismaModule, GenerationModule, UsersModule],
    controllers: [TimelineController],
    providers: [TimelineService],
    exports: [TimelineService],
})
export class TimelineModule { }
