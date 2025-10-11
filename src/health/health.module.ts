import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { QueueHealthController } from './queue-health.controller';
import { LoggerService } from '../common/logger.service';
import { MetricsService } from '../common/metrics.service';
import { RequestContextService } from '../common/request-context.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [TerminusModule, PrismaModule, JobsModule],
  controllers: [HealthController, QueueHealthController],
  providers: [LoggerService, MetricsService, RequestContextService],
})
export class HealthModule {}
