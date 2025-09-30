import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationController } from './generation.controller';
import { ImageGenerationController } from './image-generation.controller';
import { GenerationService } from './generation.service';
import { AuthModule } from '../auth/auth.module';
import { R2FilesModule } from '../r2files/r2files.module';
import { R2Service } from '../upload/r2.service';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ConfigModule, AuthModule, R2FilesModule, UsageModule],
  controllers: [GenerationController, ImageGenerationController],
  providers: [GenerationService, R2Service],
  exports: [GenerationService],
})
export class GenerationModule {}
