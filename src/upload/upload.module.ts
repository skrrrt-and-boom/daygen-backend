import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { R2Service } from './r2.service';
import { R2FilesService } from '../r2files/r2files.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UploadController],
  providers: [R2Service, R2FilesService],
  exports: [R2Service],
})
export class UploadModule {}
