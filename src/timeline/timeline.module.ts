import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { TimelineService } from './timeline.service';
import { AudioModule } from '../audio/audio.module';
import { UploadModule } from '../upload/upload.module';

import { TimelineController } from './timeline.controller';

import { PrismaModule } from '../prisma/prisma.module';

import { GenerationModule } from '../generation/generation.module';
import { UsersModule } from '../users/users.module';

import { KlingProvider } from '../generation/providers/kling.provider';

@Module({
    imports: [ConfigModule, AudioModule, UploadModule, PrismaModule, forwardRef(() => GenerationModule), UsersModule],
    controllers: [TimelineController, WebhookController],
    providers: [TimelineService, KlingProvider],
    exports: [TimelineService],
})
export class TimelineModule { }
