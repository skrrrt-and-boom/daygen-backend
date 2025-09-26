import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { R2Service } from './r2.service';

@Module({
  controllers: [UploadController],
  providers: [R2Service],
  exports: [R2Service],
})
export class UploadModule {}
