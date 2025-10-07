import { Injectable, Logger } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatus, JobType } from '@prisma/client';
import { CreateImageGenerationJobDto } from './dto/create-image-generation-job.dto';
import { CreateVideoGenerationJobDto } from './dto/create-video-generation-job.dto';
import { CreateImageUpscaleJobDto } from './dto/create-image-upscale-job.dto';
import { CreateBatchGenerationJobDto } from './dto/create-batch-generation-job.dto';

@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly client: CloudTasksClient;
  private readonly projectId: string;
  private readonly location: string;
  private readonly baseUrl: string;

  // Queue names for different job types
  private readonly queueNames = {
    [JobType.IMAGE_GENERATION]: 'image-generation-queue',
    [JobType.VIDEO_GENERATION]: 'video-generation-queue',
    [JobType.IMAGE_UPSCALE]: 'image-upscale-queue',
    [JobType.BATCH_GENERATION]: 'batch-generation-queue',
  };

  constructor(private prisma: PrismaService) {
    this.client = new CloudTasksClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || 'daygen-backend';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'europe-central2';
    this.baseUrl =
      process.env.API_BASE_URL ||
      'https://daygen-backend-365299591811.europe-central2.run.app';
  }

  private async createJob(userId: string, jobType: JobType, data: any) {
    // Create job record in database
    const job = await this.prisma.job.create({
      data: {
        userId,
        type: jobType,
        status: JobStatus.PENDING,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: data,
      },
    });

    this.logger.log(`Created ${jobType} job ${job.id} for user ${userId}`);

    // Create Cloud Task
    const queuePath = this.client.queuePath(
      this.projectId,
      this.location,
      this.queueNames[jobType],
    );

    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${this.baseUrl}/api/jobs/process`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY || 'internal-key'}`,
        },
        body: Buffer.from(
          JSON.stringify({
            jobId: job.id,
            userId,
            jobType,
            ...data,
          }),
        ).toString('base64'),
      },
      scheduleTime: {
        seconds: Date.now() / 1000 + 1, // Execute in 1 second
      },
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });

      this.logger.log(
        `Created Cloud Task for ${jobType} job ${job.id}: ${response.name}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create Cloud Task for ${jobType} job ${job.id}:`,
        error,
      );
      // Update job status to failed
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          error: 'Failed to create Cloud Task',
        },
      });
      throw error;
    }

    return { jobId: job.id };
  }

  async createImageGenerationJob(
    userId: string,
    data: CreateImageGenerationJobDto,
  ) {
    return this.createJob(userId, JobType.IMAGE_GENERATION, data);
  }

  async createVideoGenerationJob(
    userId: string,
    data: CreateVideoGenerationJobDto,
  ) {
    return this.createJob(userId, JobType.VIDEO_GENERATION, data);
  }

  async createImageUpscaleJob(userId: string, data: CreateImageUpscaleJobDto) {
    return this.createJob(userId, JobType.IMAGE_UPSCALE, data);
  }

  async createBatchGenerationJob(
    userId: string,
    data: CreateBatchGenerationJobDto,
  ) {
    return this.createJob(userId, JobType.BATCH_GENERATION, data);
  }

  async getJobStatus(jobId: string, userId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: {
        id: true,
        status: true,
        progress: true,
        resultUrl: true,
        error: true,
        createdAt: true,
        completedAt: true,
        metadata: true,
      },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    return job;
  }

  async updateJobProgress(jobId: string, progress: number, status?: JobStatus) {
    const updateData: Record<string, unknown> = { progress };
    if (status) updateData.status = status;
    if (progress === 100) updateData.completedAt = new Date();

    await this.prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });

    this.logger.log(`Updated job ${jobId} progress to ${progress}%`);
  }

  async completeJob(jobId: string, resultUrl: string) {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        progress: 100,
        resultUrl,
        completedAt: new Date(),
      },
    });

    this.logger.log(`Completed job ${jobId} with result: ${resultUrl}`);
  }

  async failJob(jobId: string, error: string) {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error,
        completedAt: new Date(),
      },
    });

    this.logger.error(`Failed job ${jobId}: ${error}`);
  }

  async getUserJobs(userId: string, limit = 20, cursor?: string) {
    const jobs = await this.prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        resultUrl: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const hasNextPage = jobs.length > limit;
    if (hasNextPage) {
      jobs.pop();
    }

    const nextCursor = hasNextPage ? jobs[jobs.length - 1]?.id : null;

    return {
      jobs,
      nextCursor,
      hasNextPage,
    };
  }

  async getUserByAuthId(authUserId: string) {
    return this.prisma.user.findUnique({
      where: { authUserId },
      select: {
        id: true,
        authUserId: true,
        email: true,
      },
    });
  }
}
