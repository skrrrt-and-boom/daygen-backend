import { Controller, Post, Body, Headers, Logger } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobProcessingService } from './job-processing.service';
import type { ProcessJobPayload } from './job-processing.service';

@Controller('jobs')
export class TaskProcessorController {
  private readonly logger = new Logger(TaskProcessorController.name);

  constructor(private readonly jobProcessingService: JobProcessingService) {}

  @Post('process')
  async processTask(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') auth: string,
  ) {
    // Verify internal API key
    const expectedAuth = `Bearer ${process.env.INTERNAL_API_KEY || 'internal-key'}`;
    if (auth !== expectedAuth) {
      this.logger.error('Unauthorized task processing attempt');
      throw new Error('Unauthorized');
    }

    const jobId = body.jobId as string;
    const userId = body.userId as string;
    const jobType = body.jobType as JobType;
    const jobData = { ...body };
    delete jobData.jobId;
    delete jobData.userId;
    delete jobData.jobType;

    this.logger.log(
      `Processing ${jobType} Cloud Task for job ${jobId} for user ${userId}`,
    );

    const payload: ProcessJobPayload = {
      jobId,
      userId,
      jobType,
      data: jobData,
    };

    await this.jobProcessingService.processJob(payload);
  }
}
