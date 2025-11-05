import { Module, forwardRef } from '@nestjs/common';
import { CloudTasksService } from './cloud-tasks.service';
import { JobsController } from './jobs.controller';
import { TaskProcessorController } from './task-processor.controller';
import { JobsGateway } from './jobs.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { GenerationModule } from '../generation/generation.module';
import { R2FilesModule } from '../r2files/r2files.module';
import { UploadModule } from '../upload/upload.module';
import { UsageModule } from '../usage/usage.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobProcessingService } from './job-processing.service';
import { LoggerService } from '../common/logger.service';
import { MetricsService } from '../common/metrics.service';
import { RequestContextService } from '../common/request-context.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => GenerationModule),
    R2FilesModule,
    UploadModule,
    UsageModule,
    PaymentsModule,
  ],
  providers: [
    CloudTasksService,
    JobProcessingService,
    JobsGateway,
    LoggerService,
    MetricsService,
    RequestContextService,
  ],
  controllers: [JobsController, TaskProcessorController],
  exports: [
    CloudTasksService,
    JobProcessingService,
    JobsGateway,
    LoggerService,
    MetricsService,
    RequestContextService,
  ],
})
export class JobsModule {}
