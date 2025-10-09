import { Module, forwardRef } from '@nestjs/common';
import { CloudTasksService } from './cloud-tasks.service';
import { JobsController } from './jobs.controller';
import { TaskProcessorController } from './task-processor.controller';
import { JobsGateway } from './jobs.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { GenerationModule } from '../generation/generation.module';
import { R2FilesModule } from '../r2files/r2files.module';
import { UsageModule } from '../usage/usage.module';
import { JobProcessingService } from './job-processing.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => GenerationModule),
    R2FilesModule,
    UsageModule,
  ],
  providers: [CloudTasksService, JobProcessingService, JobsGateway],
  controllers: [JobsController, TaskProcessorController],
  exports: [CloudTasksService, JobProcessingService, JobsGateway],
})
export class JobsModule {}
