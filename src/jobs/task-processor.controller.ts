import { Controller, Post, Body, Headers, Logger } from '@nestjs/common';
import { GenerationService } from '../generation/generation.service';
import { R2FilesService } from '../r2files/r2files.service';
import { UsageService } from '../usage/usage.service';
import { CloudTasksService } from './cloud-tasks.service';
import { JobStatus, JobType } from '@prisma/client';
import type { SanitizedUser } from '../users/types';
// import type { ProviderGenerateDto } from '../generation/types';

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

    try {
      // Update status to processing
      await this.cloudTasksService.updateJobProgress(
        jobId,
        0,
        JobStatus.PROCESSING,
      );

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
          throw new Error(`Unknown job type: ${String(jobType)}`);
      }

      this.logger.log(`Successfully completed ${jobType} job ${jobId}`);
    } catch (error) {
      this.logger.error(`${String(jobType)} job ${jobId} failed:`, error);
      
      // Extract more detailed error information
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // If it's an HttpException, extract more details
        if ('getResponse' in error && typeof error.getResponse === 'function') {
          const response = error.getResponse();
          if (typeof response === 'object' && response !== null) {
            const responseObj = response as Record<string, unknown>;
            if ('error' in responseObj) {
              errorMessage = `${error.message}: ${String(responseObj.error)}`;
            }
            if ('details' in responseObj) {
              errorMessage += ` (Details: ${String(responseObj.details)})`;
            }
          }
        }
      }
      
      await this.cloudTasksService.failJob(jobId, errorMessage);
      throw error;
    }
  }

  private async processImageGeneration(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const prompt = data.prompt as string;
    const model = data.model as string;
    const provider = data.provider as string;
    const options = (data.options as Record<string, unknown>) || {};

    // Validate required fields
    if (!prompt?.trim()) {
      throw new Error('Prompt is required');
    }
    if (!model?.trim()) {
      throw new Error('Model is required');
    }
    if (!provider?.trim()) {
      throw new Error('Provider is required');
    }

    // Map queue model names to generation service model names
    const mappedModel = this.mapQueueModelToGenerationModel(model, provider);

    this.logger.log(`Processing image generation with model: ${mappedModel}, provider: ${provider}`, {
      jobId,
      userId,
      originalModel: model,
      mappedModel,
      provider,
    });

    // Look up user to get authUserId
    const user = await this.cloudTasksService.getUserByAuthId(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Check credits
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: user.authUserId } as SanitizedUser,
      1,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 25);

    // Generate image with retry logic for transient failures
    let result;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await this.generationService.generateForModel(
          { authUserId: user.authUserId } as SanitizedUser,
          mappedModel,
          { prompt, model: mappedModel, provider, ...options } as any,
        );
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        
        // Check if this is a retryable error
        const isRetryable = this.isRetryableError(error);
        
        if (attempt === maxRetries || !isRetryable) {
          throw error; // Don't retry on last attempt or non-retryable errors
        }
        
        this.logger.warn(`Generation attempt ${attempt} failed, retrying...`, {
          jobId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          isRetryable,
        });
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    if (!result) {
      throw lastError || new Error('Generation failed after all retry attempts');
    }

    this.logger.log(
      `Generation result for job ${jobId}:`,
      JSON.stringify(result, null, 2),
    );

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // Extract file URL and MIME type from result
    let fileUrl: string;
    let mimeType: string;

    if (result && typeof result === 'object') {
      const resultObj = result as Record<string, unknown>;
      // Handle different result structures
      if ('dataUrl' in resultObj) {
        fileUrl = resultObj.dataUrl as string;
        mimeType = (resultObj.contentType as string) || 'image/jpeg';
      } else if (
        'assets' in resultObj &&
        Array.isArray(resultObj.assets) &&
        resultObj.assets.length > 0
      ) {
        const firstAsset = resultObj.assets[0] as Record<string, unknown>;
        fileUrl =
          (firstAsset.remoteUrl as string) || (firstAsset.dataUrl as string);
        mimeType = (firstAsset.mimeType as string) || 'image/jpeg';
      } else if ('remoteUrl' in resultObj) {
        fileUrl = resultObj.remoteUrl as string;
        mimeType = (resultObj.mimeType as string) || 'image/jpeg';
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
    const r2File = await this.r2FilesService.create(user.authUserId, {
      fileName: `generated-${Date.now()}.png`,
      fileUrl,
      mimeType,
      prompt,
      model,
    });

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: user.authUserId } as SanitizedUser,
      {
        provider,
        model,
        prompt,
        cost: 1,
      },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, r2File.fileUrl);
  }

  private async processVideoGeneration(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const prompt = data.prompt as string;
    const model = data.model as string;
    const provider = data.provider as string;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const options = data.options as Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const imageUrls = data.imageUrls as string[] | undefined;

    // Check credits (video generation costs more)
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
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
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate processing

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // TODO: Save video to R2 and create file record
    const videoUrl = `https://example.com/video-${Date.now()}.mp4`;

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: userId } as SanitizedUser,
      {
        provider,
        model,
        prompt,
        cost: 5,
      },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, videoUrl);
  }

  private async processImageUpscale(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const imageUrl = data.imageUrl as string;
    const model = data.model as string;
    const provider = data.provider as string;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const scale = data.scale as number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const options = data.options as Record<string, unknown> | undefined;

    // Check credits
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
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
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing

    // Update progress
    await this.cloudTasksService.updateJobProgress(jobId, 75);

    // TODO: Save upscaled image to R2 and create file record
    const upscaledUrl = `https://example.com/upscaled-${Date.now()}.png`;

    // Record usage
    await this.usageService.recordGeneration(
      { authUserId: userId } as SanitizedUser,
      {
        provider,
        model,
        prompt: `Upscale ${imageUrl}`,
        cost: 2,
      },
    );

    // Complete job
    await this.cloudTasksService.completeJob(jobId, upscaledUrl);
  }

  private async processBatchGeneration(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const prompts = data.prompts as string[];
    const model = data.model as string;
    const provider = data.provider as string;
    const batchSize = (data.batchSize as number) || 5;
    const options = (data.options as Record<string, unknown>) || {};

    // Check credits (batch generation costs more)
    const totalCost = prompts.length * 1; // 1 credit per image
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
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
            { authUserId: userId } as SanitizedUser,
            model,
            {
              prompt,
              model,
              provider,
              ...options,
            } as any,
          );

          // Extract file URL from result
          let fileUrl: string;
          let mimeType: string;

          if (result && typeof result === 'object') {
            const resultObj = result as Record<string, unknown>;
            if ('dataUrl' in resultObj) {
              fileUrl = resultObj.dataUrl as string;
              mimeType = (resultObj.contentType as string) || 'image/jpeg';
            } else if (
              'assets' in resultObj &&
              Array.isArray(resultObj.assets) &&
              resultObj.assets.length > 0
            ) {
              const firstAsset = resultObj.assets[0] as Record<string, unknown>;
              fileUrl =
                (firstAsset.remoteUrl as string) ||
                (firstAsset.dataUrl as string);
              mimeType = (firstAsset.mimeType as string) || 'image/jpeg';
            } else if ('remoteUrl' in resultObj) {
              fileUrl = resultObj.remoteUrl as string;
              mimeType = (resultObj.mimeType as string) || 'image/jpeg';
            } else {
              // Fallback: try to extract URL from any string property
              const resultStr = JSON.stringify(result);
              const urlMatch = resultStr.match(/https?:\/\/[^\s"']+/);
              if (urlMatch) {
                fileUrl = urlMatch[0];
                mimeType = 'image/jpeg';
              } else {
                this.logger.error(
                  `Cannot extract file URL from batch result: ${resultStr}`,
                );
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
            { authUserId: userId } as SanitizedUser,
            { provider, model, prompt, cost: 1 },
          );
        } catch (error) {
          this.logger.error(
            `Failed to process prompt "${prompt}" in batch:`,
            error,
          );
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

  private mapQueueModelToGenerationModel(model: string, provider: string): string {
    // Map common model variations to the expected generation service models
    const modelMappings: Record<string, string> = {
      // Gemini models
      'gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
      
      // Flux models
      'flux-1.1': 'flux-pro-1.1',
      'flux-pro-1.1': 'flux-pro-1.1',
      'flux-pro-1.1-ultra': 'flux-pro-1.1-ultra',
      'flux-kontext-pro': 'flux-kontext-pro',
      'flux-kontext-max': 'flux-kontext-max',
      'flux-pro': 'flux-pro',
      'flux-dev': 'flux-dev',
      
      // Reve models
      'reve-image': 'reve-image',
      'reve-image-1.0': 'reve-image-1.0',
      'reve-v1': 'reve-v1',
      
      // Recraft models
      'recraft': 'recraft-v3',
      'recraft-v2': 'recraft-v2',
      'recraft-v3': 'recraft-v3',
      
      // Luma models
      'luma-photon-1': 'luma-photon-1',
      'luma-photon-flash-1': 'luma-photon-flash-1',
      'luma-dream-shaper': 'luma-dream-shaper',
      'luma-realistic-vision': 'luma-realistic-vision',
      
      // Other models
      'ideogram': 'ideogram',
      'qwen-image': 'qwen-image',
      'runway-gen4': 'runway-gen4',
      'runway-gen4-turbo': 'runway-gen4-turbo',
      'chatgpt-image': 'chatgpt-image',
      'seedream-3.0': 'seedream-3.0',
    };

    return modelMappings[model] || model;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      // Check for retryable error patterns
      const retryablePatterns = [
        'timeout',
        'network',
        'connection',
        'rate limit',
        'too many requests',
        'service unavailable',
        'internal server error',
        'bad gateway',
        'gateway timeout',
        'temporary',
        'retry',
        '429', // HTTP 429 Too Many Requests
        '502', // HTTP 502 Bad Gateway
        '503', // HTTP 503 Service Unavailable
        '504', // HTTP 504 Gateway Timeout
      ];
      
      return retryablePatterns.some(pattern => message.includes(pattern));
    }
    
    return false;
  }
}
