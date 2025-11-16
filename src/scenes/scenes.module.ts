import { Module, forwardRef } from '@nestjs/common';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';
import { UsageModule } from '../usage/usage.module';
import { PaymentsModule } from '../payments/payments.module';
import { UploadModule } from '../upload/upload.module';
import { R2FilesModule } from '../r2files/r2files.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [UsageModule, PaymentsModule, UploadModule, R2FilesModule, forwardRef(() => JobsModule)],
  controllers: [ScenesController],
  providers: [ScenesService],
  exports: [ScenesService],
})
export class ScenesModule {}

