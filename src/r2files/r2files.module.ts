import { Module } from '@nestjs/common';
import { R2FilesService } from './r2files.service';
import { R2FilesController } from './r2files.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { R2Service } from '../upload/r2.service';

@Module({
  imports: [PrismaModule],
  controllers: [R2FilesController],
  providers: [R2FilesService, R2Service],
  exports: [R2FilesService],
})
export class R2FilesModule {}
