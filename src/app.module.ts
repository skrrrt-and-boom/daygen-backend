import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { TemplatesModule } from './templates/templates.module';
import { AuthModule } from './auth/auth.module';
import { GalleryModule } from './gallery/gallery.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
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
    TemplatesModule,
    GalleryModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
