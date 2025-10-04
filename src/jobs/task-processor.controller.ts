import { Controller, Post, Body, Headers, Logger } from '@nestjs/common';
import { GenerationService } from '../generation/generation.service';
import { R2FilesService } from '../r2files/r2files.service';
import { UsageService } from '../usage/usage.service';
import { CloudTasksService } from './cloud-tasks.service';
import { JobStatus, JobType } from '@prisma/client';

@Controller('jobs')
export class TaskProcessorController {
  private readonly logger = new Logger(TaskProcessorController.name);

  constructor(
    private generationService: GenerationService,
    private r2FilesService: R2FilesService,
    private usageService: UsageService,
    private cloudTasksService: CloudTasksService,
  ) {}

  @Post('process')
  async processTask(
    @Body() body: any,
    @Headers('authorization') auth: string,
  ) {
    // Verify internal API key
    const expectedAuth = `Bearer ${process.env.INTERNAL_API_KEY || 'internal-key'}`;
    if (auth !== expectedAuth) {
      this.logger.error('Unauthorized task processing attempt');
      throw new Error('Unauthorized');
    }

    const { jobId, userId, jobType, ...jobData } = body;

    this.logger.log(`Processing ${jobType} Cloud Task for job ${jobId} for user ${userId}`);

    try {
      // Update status to processing
      await this.cloudTasksService.updateJobProgress(jobId, 0, JobStatus.PROCESSING);

      // Route to appropriate handler based on job type
      switch (jobType) {
        case JobType.IMAGE_GENERATION:
          await this.processImageGeneration(jobId, userId, jobData);
          break;
        case JobType.VIDEO_GENERATION:
          await this.processVideoGeneration(jobId, userId, jobData);
          break;
        case JobType.IMAGE_UPSCALE:
          await this.processImageUpscale(jobId, userId, jobData);
          break;
        case JobType.BATCH_GENERATION:
          await this.processBatchGeneration(jobId, userId, jobData);
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      this.logger.log(`Successfully completed ${jobType} job ${jobId}`);

    } catch (error) {
      this.logger.error(`${jobType} job ${jobId} failed:`, error);
      await this.cloudTasksService.failJob(jobId, error.message);
      throw error;
    }
  }

  private async processImageGeneration(jobId: string, userId: string, data: any) {
    const { prompt, model, provider, options } = data;

    // Check credits
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as any,
      1,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 25);

    // Generate image
    const result = await this.generationService.generateForModel(
      { authUserId: userId } as any,
      model,
      { prompt, model, provider, ...options },
    );

    this.logger.log(`Generation result for job ${jobId}:`, JSON.stringify(result, null, 2));

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // Extract file URL and MIME type from result
    let fileUrl: string;
    let mimeType: string;

    if (result && typeof result === 'object') {
      // Handle different result structures
      if ('dataUrl' in result) {
        fileUrl = (result as any).dataUrl;
        mimeType = (result as any).contentType || 'image/jpeg';
      } else if ('assets' in result && Array.isArray((result as any).assets) && (result as any).assets.length > 0) {
        fileUrl = (result as any).assets[0].remoteUrl || (result as any).assets[0].dataUrl;
        mimeType = (result as any).assets[0].mimeType || 'image/jpeg';
      } else if ('remoteUrl' in result) {
        fileUrl = (result as any).remoteUrl;
        mimeType = (result as any).mimeType || 'image/jpeg';
      } else {
        // Fallback: try to extract URL from any string property
        const resultStr = JSON.stringify(result);
        const urlMatch = resultStr.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) {
          fileUrl = urlMatch[0];
          mimeType = 'image/jpeg';
        } else {
          throw new Error(`Cannot extract file URL from result: ${resultStr}`);
        }
      }
    } else {
      throw new Error(`Invalid result type: ${typeof result}`);
    }

    // Save to R2
    const r2File = await this.r2FilesService.create(userId, {
      fileName: `generated-${Date.now()}.png`,
      fileUrl,
      mimeType,
      prompt,
      model,
    });

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: userId } as any,
      { provider, model, prompt, cost: 1 },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, r2File.fileUrl);
  }

  private async processVideoGeneration(jobId: string, userId: string, data: any) {
    const { prompt, model, provider, options, imageUrls } = data;

    // Check credits (video generation costs more)
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as any,
      5, // Video generation costs 5 credits
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 25);

    // TODO: Implement video generation logic
    // This would call a video generation service
    // For now, we'll simulate the process
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // TODO: Save video to R2 and create file record
    const videoUrl = `https://example.com/video-${Date.now()}.mp4`;

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: userId } as any,
      { provider, model, prompt, cost: 5 },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, videoUrl);
  }

  private async processImageUpscale(jobId: string, userId: string, data: any) {
    const { imageUrl, model, provider, scale, options } = data;

    // Check credits
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as any,
      2, // Upscaling costs 2 credits
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 25);

    // TODO: Implement image upscaling logic
    // This would call an upscaling service
    // For now, we'll simulate the process
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // TODO: Save upscaled image to R2 and create file record
    const upscaledUrl = `https://example.com/upscaled-${Date.now()}.png`;

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: userId } as any,
      { provider, model, prompt: `Upscale ${imageUrl}`, cost: 2 },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, upscaledUrl);
  }

  private async processBatchGeneration(jobId: string, userId: string, data: any) {
    const { prompts, model, provider, batchSize = 5, options } = data;

    // Check credits (batch generation costs more)
    const totalCost = prompts.length * 1; // 1 credit per image
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as any,
      totalCost,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 10);

    const results: string[] = [];
    const totalPrompts = prompts.length;

    // Process prompts in batches
    for (let i = 0; i < prompts.length; i += batchSize) {
      const batch = prompts.slice(i, i + batchSize);
      
      // Process each prompt in the batch
      for (const prompt of batch) {
        try {
          // Generate image
          const result = await this.generationService.generateForModel(
            { authUserId: userId } as any,
            model,
            { prompt, model, provider, ...options },
          );

          // Extract file URL from result
          let fileUrl: string;
          let mimeType: string;

          if (result && typeof result === 'object') {
            if ('dataUrl' in result) {
              fileUrl = (result as any).dataUrl;
              mimeType = (result as any).contentType || 'image/jpeg';
            } else if ('assets' in result && Array.isArray((result as any).assets) && (result as any).assets.length > 0) {
              fileUrl = (result as any).assets[0].remoteUrl || (result as any).assets[0].dataUrl;
              mimeType = (result as any).assets[0].mimeType || 'image/jpeg';
            } else if ('remoteUrl' in result) {
              fileUrl = (result as any).remoteUrl;
              mimeType = (result as any).mimeType || 'image/jpeg';
            } else {
              // Fallback: try to extract URL from any string property
              const resultStr = JSON.stringify(result);
              const urlMatch = resultStr.match(/https?:\/\/[^\s"']+/);
              if (urlMatch) {
                fileUrl = urlMatch[0];
                mimeType = 'image/jpeg';
              } else {
                this.logger.error(`Cannot extract file URL from batch result: ${resultStr}`);
                continue; // Skip this prompt and continue with others
              }
            }
          } else {
            this.logger.error(`Invalid batch result type: ${typeof result}`);
            continue; // Skip this prompt and continue with others
          }

          // Save to R2
          const r2File = await this.r2FilesService.create(userId, {
            fileName: `batch-generated-${Date.now()}-${i}.png`,
            fileUrl,
            mimeType,
            prompt,
            model,
          });

          results.push(r2File.fileUrl);

          // Record usage
          await this.usageService.recordGeneration(
            { authUserId: userId } as any,
            { provider, model, prompt, cost: 1 },
          );

        } catch (error) {
          this.logger.error(`Failed to process prompt "${prompt}" in batch:`, error);
          // Continue with other prompts
        }
      }

      // Update progress
      const progress = Math.min(90, 10 + ((i + batchSize) / totalPrompts) * 80);
      await this.cloudTasksService.updateJobProgress(jobId, progress);
    }

    // Complete job with results
    const resultUrl = JSON.stringify({ results, count: results.length });
    await this.cloudTasksService.completeJob(jobId, resultUrl);
  }
}
