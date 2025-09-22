import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { AuthModule } from '../auth/auth.module';
import { GalleryModule } from '../gallery/gallery.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ConfigModule, AuthModule, GalleryModule, UsageModule],
  controllers: [GenerationController],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
