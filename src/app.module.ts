import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { TemplatesModule } from './templates/templates.module';
import { AuthModule } from './auth/auth.module';
import { GalleryModule } from './gallery/gallery.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, TemplatesModule, GalleryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
