import { Controller, Get, Param } from '@nestjs/common';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { MetricsService } from '../common/metrics.service';
import { LoggerService } from '../common/logger.service';

@Controller('health/queues')
export class QueueHealthController {
  constructor(
    private readonly cloudTasksService: CloudTasksService,
    private readonly metricsService: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  @Get()
  getQueueHealth() {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cloudTasksEnabled: process.env.ENABLE_CLOUD_TASKS === 'true',
        queues: this.getQueueStatuses(),
        processingStats: this.getProcessingStats(),
      };

      this.logger.log('Queue health check completed', health);
      return health;
    } catch (error) {
      this.logger.logError(error as Error, { context: 'queue_health_check' });
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('metrics')
  async getQueueMetrics() {
    try {
      const metrics = await this.metricsService.getMetrics();
      return {
        metrics,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.logError(error as Error, { context: 'queue_metrics' });
      throw error;
    }
  }

  @Get('job/:jobId/debug')
  async getJobDebugInfo(@Param('jobId') jobId: string) {
    try {
      const job = await this.cloudTasksService.getJobStatus(jobId, 'debug');
      const debugInfo = {
        job,
        requestId: 'debug-request',
        timestamp: new Date().toISOString(),
      };

      this.logger.log('Job debug info retrieved', { jobId, debugInfo });
      return debugInfo;
    } catch (error) {
      this.logger.logError(error as Error, { context: 'job_debug', jobId });
      throw error;
    }
  }

  private getQueueStatuses() {
    // This would integrate with Cloud Tasks API to get actual queue depths
    // For now, return mock data
    return {
      'image-generation-queue': {
        depth: 0,
        processingRate: 0,
        errorRate: 0,
      },
      'video-generation-queue': {
        depth: 0,
        processingRate: 0,
        errorRate: 0,
      },
      'image-upscale-queue': {
        depth: 0,
        processingRate: 0,
        errorRate: 0,
      },
      'batch-generation-queue': {
        depth: 0,
        processingRate: 0,
        errorRate: 0,
      },
    };
  }

  private getProcessingStats() {
    // This would get actual processing statistics
    return {
      totalJobsProcessed: 0,
      activeJobs: 0,
      averageProcessingTime: 0,
      errorRate: 0,
    };
  }
}
