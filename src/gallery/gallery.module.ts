import { Module } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { GalleryController } from './gallery.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Service } from '../upload/r2.service';

@Module({
  imports: [PrismaModule],
  controllers: [GalleryController],
  providers: [GalleryService, R2Service],
  exports: [GalleryService],
})
export class GalleryModule {}
