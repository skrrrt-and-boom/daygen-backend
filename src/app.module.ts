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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.image-services', '.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
