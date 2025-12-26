import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { CreateImageGenerationJobDto } from './dto/create-image-generation-job.dto';
import { CreateVideoGenerationJobDto } from './dto/create-video-generation-job.dto';
import { CreateImageUpscaleJobDto } from './dto/create-image-upscale-job.dto';
import { CreateBatchGenerationJobDto } from './dto/create-batch-generation-job.dto';
import { JobProcessingService } from './job-processing.service';
import type { ProcessJobPayload } from './job-processing.service';
import { TimelineService } from '../timeline/timeline.service';

@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly client: CloudTasksClient | null;
  private readonly projectId: string;
  private readonly location: string;
  private readonly baseUrl: string;
  private readonly useCloudTasks: boolean;

  // Queue names for different job types
  private readonly queueNames = {
    [JobType.IMAGE_GENERATION]: 'image-generation-queue',
    [JobType.VIDEO_GENERATION]: 'video-generation-queue',
    [JobType.IMAGE_UPSCALE]: 'image-upscale-queue',
    [JobType.BATCH_GENERATION]: 'batch-generation-queue',
    [JobType.SCENE_GENERATION]: 'scene-generation-queue',
    [JobType.IMAGE_EDIT]: 'image-generation-queue', // Reuse image generation queue
    [JobType.IMAGE_RESIZE]: 'image-generation-queue', // Reuse image generation queue
    [JobType.RECREATE_IMAGE]: 'image-generation-queue', // Reuse image generation queue
  };

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => JobProcessingService))
    private readonly jobProcessingService?: JobProcessingService,
    @Optional()
    @Inject(forwardRef(() => TimelineService))
    private readonly timelineService?: TimelineService,
  ) {
    this.useCloudTasks = process.env.ENABLE_CLOUD_TASKS === 'true';
    this.client = this.useCloudTasks ? new CloudTasksClient() : null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || 'daygen-backend';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'europe-central2';
    this.baseUrl =
      process.env.API_BASE_URL ||
      'https://daygen-backend-365299591811.europe-central2.run.app';
  }

  private async createJob(userId: string, jobType: JobType, data: unknown) {
    const serializedData = this.serializeJobData(data);

    const job = await this.prisma.job.create({
      data: {
        userId,
        type: jobType,
        status: JobStatus.PENDING,
        metadata: serializedData as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Created ${jobType} job ${job.id} for user ${userId}`);

    if (this.useCloudTasks && this.client) {
      await this.enqueueCloudTask(job.id, userId, jobType, serializedData);
    } else {
      this.logger.log(
        `Cloud Tasks disabled; processing ${jobType} job ${job.id} locally`,
      );

      const processor = this.jobProcessingService;

      if (!processor) {
        this.logger.error(
          'JobProcessingService is not available; marking job as failed.',
        );
        await this.failJob(job.id, 'Local job processor unavailable');
      } else {
        const payload: ProcessJobPayload = {
          jobId: job.id,
          userId,
          jobType,
          data: data as Record<string, unknown>,
        };

        setImmediate(() => {
          void processor.processJob(payload).catch((error) => {
            this.logger.error(
              `Inline processing failed for job ${job.id}:`,
              error,
            );
          });
        });
      }
    }

    return { jobId: job.id };
  }

  private serializeJobData(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return {};
    }

    try {
      const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;

      // Sanitize heavy fields to prevent metadata bloat
      const sanitize = (obj: any, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== 'object') return;

        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (typeof val === 'string' && val.length > 1000) {
              // Check if it looks like a base64 image or just a long string
              if (val.startsWith('data:') || val.length > 5000) {
                obj[key] = val.substring(0, 100) + '...[TRUNCATED]';
              }
            } else if (typeof val === 'object') {
              sanitize(val, depth + 1);
            }
          }
        }
      };

      sanitize(copy);
      return copy;
    } catch (error) {
      this.logger.warn(
        'Failed to serialize job metadata, falling back to empty object',
        error,
      );
      return {};
    }
  }

  private async enqueueCloudTask(
    jobId: string,
    userId: string,
    jobType: JobType,
    data: Record<string, unknown>,
  ) {
    if (!this.client) {
      throw new Error('Cloud Tasks client not initialised');
    }

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
            jobId,
            userId,
            jobType,
            ...data,
          }),
        ).toString('base64'),
      },
      scheduleTime: {
        seconds: Date.now() / 1000 + 1,
      },
    };

    try {
      const [response] = await this.client.createTask({
        parent: queuePath,
        task,
      });

      this.logger.log(
        `Created Cloud Task for ${jobType} job ${jobId}: ${response.name}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create Cloud Task for ${jobType} job ${jobId}:`,
        error,
      );
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error: 'Failed to create Cloud Task',
        },
      });
      throw error;
    }
  }

  async createImageGenerationJob(
    userId: string,
    data: CreateImageGenerationJobDto & { jobType?: string },
  ) {
    let type: JobType;
    if (data.jobType === 'IMAGE_EDIT') {
      type = JobType.IMAGE_EDIT;
    } else if (data.jobType === 'resize' || data.jobType === 'IMAGE_RESIZE') {
      type = JobType.IMAGE_RESIZE;
    } else if (data.jobType === 'RECREATE_IMAGE') {
      type = JobType.RECREATE_IMAGE;
    } else {
      type = JobType.IMAGE_GENERATION;
    }
    return this.createJob(userId, type, data);
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

  async createSceneGenerationJob(
    userId: string,
    data: Record<string, unknown>,
  ) {
    return this.createJob(userId, JobType.SCENE_GENERATION, data);
  }

  async getJobStatus(jobId: string, userId: string) {
    // Basic Fetch first to check ownership and type
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { type: true }
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.type === 'CYRAN_ROLL' && this.timelineService) {
      // Delegate to TimelineService for aggregated status (Read-Repair)
      const aggregatedJob = await this.timelineService.getAggregatedJobStatus(jobId);
      if (aggregatedJob) return aggregatedJob;
    }

    // Fallback for other job types or if service missing
    const standardJob = await this.prisma.job.findFirst({
      where: { id: jobId, userId }, // Re-fetch with full fields or use found one
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

    if (!standardJob) {
      throw new NotFoundException('Job not found');
    }

    return standardJob;
  }

  async updateJobProgress(jobId: string, progress: number, status?: JobStatus) {
    const updateData: Record<string, unknown> = { progress };
    if (status) updateData.status = status;
    if (progress === 100) updateData.completedAt = new Date();

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: updateData,
      });

      this.logger.log(`Updated job ${jobId} progress to ${progress}%`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Record to update not found')
      ) {
        this.logger.warn(
          `Job ${jobId} not found when trying to update progress - job may have been deleted or failed`,
        );
        return;
      }
      throw error;
    }
  }

  async completeJob(
    jobId: string,
    resultUrl: string,
    extraMetadata?: Record<string, unknown>,
  ) {
    // Validate that resultUrl is not a base64 data URL
    if (resultUrl && resultUrl.startsWith('data:image/')) {
      throw new Error(
        'Base64 data URLs are not allowed in job results. Please upload to R2 first and provide the public URL.',
      );
    }

    const updateData: Prisma.JobUpdateInput = {
      status: JobStatus.COMPLETED,
      progress: 100,
      resultUrl,
      completedAt: new Date(),
    };

    if (extraMetadata && Object.keys(extraMetadata).length > 0) {
      const existing = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { metadata: true },
      });

      const mergedMetadata = {
        ...this.normalizeJobMetadata(existing?.metadata),
        ...extraMetadata,
      };

      updateData.metadata = mergedMetadata as Prisma.InputJsonValue;
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });

    this.logger.log(`Completed job ${jobId} with result: ${resultUrl}`);
  }

  async failJob(jobId: string, error: string) {
    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error,
          completedAt: new Date(),
        },
      });

      this.logger.error(`Failed job ${jobId}: ${error}`);
    } catch (updateError) {
      if (
        updateError instanceof Error &&
        updateError.message.includes('Record to update not found')
      ) {
        this.logger.warn(
          `Job ${jobId} not found when trying to mark as failed - job may have been deleted`,
        );
        return;
      }
      throw updateError;
    }
  }

  async getUserJobs(userId: string, limit = 20, cursor?: string, type?: JobType) {
    console.log(`CloudTasksService.getUserJobs: Fetching jobs for user ${userId} with type ${type}`);
    const jobs = await this.prisma.job.findMany({
      where: {
        userId,
        ...(type && { type }),
      },
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
        metadata: true, // Select metadata to check for topic/prompt
      },
    });
    console.log(`CloudTasksService.getUserJobs: Found ${jobs.length} jobs. Types: ${jobs.map(j => j.type).join(', ')}`);
    console.log(`CloudTasksService.getUserJobs: Metadata samples: ${JSON.stringify(jobs.slice(0, 3).map(j => j.metadata))}`);

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
        authUserId: true,
        email: true,
      },
    });
  }

  private normalizeJobMetadata(
    metadata: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, unknown>;
  }
}
