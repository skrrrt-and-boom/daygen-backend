import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { R2FilesModule } from './r2files/r2files.module';
import { HealthModule } from './health/health.module';
import { GenerationModule } from './generation/generation.module';
import { UploadModule } from './upload/upload.module';
import { JobsModule } from './jobs/jobs.module';
import { PaymentsModule } from './payments/payments.module';
import { AudioModule } from './audio/audio.module';
import { ScenesModule } from './scenes/scenes.module';
import { TimelineModule } from './timeline/timeline.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupService } from './cleanup/cleanup.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.image-services', '.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'req.body.apiKey',
            'req.body.secret',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
        genReqId: (req, res) => {
          const headerValue = req.headers['x-request-id'];
          if (Array.isArray(headerValue)) {
            const [first] = headerValue;
            if (first) {
              res.setHeader('x-request-id', first);
              return first;
            }
          } else if (headerValue) {
            res.setHeader('x-request-id', headerValue);
            return headerValue;
          }

          const requestId = randomUUID();
          res.setHeader('x-request-id', requestId);
          return requestId;
        },
        customProps: (req) => ({
          requestId: (req as { id?: string }).id,
        }),
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    R2FilesModule,
    HealthModule,
    GenerationModule,
    UploadModule,
    JobsModule,
    PaymentsModule,
    AudioModule,
    ScenesModule,
    TimelineModule,
  ],
  controllers: [AppController],
  providers: [AppService, CleanupService],
})
export class AppModule { }
