import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { GenerationService } from '../generation/generation.service';
import { R2FilesService } from '../r2files/r2files.service';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { CloudTasksService } from './cloud-tasks.service';
import { LoggerService } from '../common/logger.service';
import { MetricsService } from '../common/metrics.service';
import { RequestContextService } from '../common/request-context.service';
import type { SanitizedUser } from '../users/types';
import type { ProviderGenerateDto } from '../generation/dto/base-generate.dto';

export interface ProcessJobPayload {
  jobId: string;
  userId: string;
  jobType: JobType;
  data: Record<string, unknown>;
}

@Injectable()
export class JobProcessingService {
  private readonly logger = new Logger(JobProcessingService.name);

  constructor(
    private readonly generationService: GenerationService,
    private readonly r2FilesService: R2FilesService,
    private readonly usageService: UsageService,
    private readonly paymentsService: PaymentsService,
    private readonly structuredLogger: LoggerService,
    private readonly metricsService: MetricsService,
    private readonly requestContext: RequestContextService,
    @Inject(forwardRef(() => CloudTasksService))
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  async processJob(payload: ProcessJobPayload) {
    const { jobId, userId, jobType, data } = payload;
    const startTime = Date.now();
    const requestId = this.requestContext.getRequestId();

    // Set context for this job
    this.requestContext.setContext('jobId', jobId);
    this.requestContext.setContext('userId', userId);
    this.requestContext.setContext('jobType', jobType);

    this.structuredLogger.logJobEvent('job_started', {
      jobId,
      userId,
      jobType,
      requestId,
      processingMode: 'inline',
    });

    // Record metrics
    const provider = (data.provider as string) || 'unknown';
    this.metricsService.recordJobStart(jobType, provider);

    await this.cloudTasksService.updateJobProgress(
      jobId,
      0,
      JobStatus.PROCESSING,
    );

    try {
      switch (jobType) {
        case JobType.IMAGE_GENERATION:
          await this.processImageGeneration(jobId, userId, data);
          break;
        case JobType.VIDEO_GENERATION:
          await this.processVideoGeneration(jobId, userId, data);
          break;
        case JobType.IMAGE_UPSCALE:
          await this.processImageUpscale(jobId, userId, data);
          break;
        case JobType.BATCH_GENERATION:
          await this.processBatchGeneration(jobId, userId, data);
          break;
        default:
          throw new Error(`Unknown job type: ${String(jobType)}`);
      }

      const duration = (Date.now() - startTime) / 1000;
      this.structuredLogger.logJobEvent('job_completed', {
        jobId,
        userId,
        jobType,
        requestId,
        duration,
      });

      this.metricsService.recordJobComplete(jobType, provider, duration);
      this.logger.log(`Successfully completed ${jobType} job ${jobId}`);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorType =
        error instanceof Error ? error.constructor.name : 'UnknownError';

      this.structuredLogger.logError(error as Error, {
        jobId,
        userId,
        jobType,
        requestId,
        duration,
        errorType,
      });

      this.metricsService.recordJobError(
        jobType,
        provider,
        errorType,
        duration,
      );

      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;

        try {
          const getResponse = (error as { getResponse?: () => unknown })
            ?.getResponse;
          if (typeof getResponse === 'function') {
            const response = getResponse();
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
        } catch (responseError) {
          // If getResponse fails, just use the original error message
          this.logger.warn(
            'Failed to extract response from error',
            responseError,
          );
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
    if (!prompt?.trim()) {
      throw new Error('Prompt is required');
    }
    if (!model?.trim()) {
      throw new Error('Model is required');
    }
    if (!provider?.trim()) {
      throw new Error('Provider is required');
    }

    const mappedModel = this.mapQueueModelToGenerationModel(model);

    this.logger.log(
      `Processing image generation with model: ${mappedModel}, provider: ${provider}`,
      {
        jobId,
        userId,
        originalModel: model,
        mappedModel,
        provider,
      },
    );

    const user = await this.cloudTasksService.getUserByAuthId(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const hasCredits = await this.usageService.checkCredits(
      { authUserId: user.authUserId } as SanitizedUser,
      1,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    // Record usage and deduct credits first
    const usageResult = await this.usageService.recordGeneration(
      { authUserId: user.authUserId } as SanitizedUser,
      {
        provider: 'job_queue',
        model: mappedModel,
        prompt,
        cost: 1,
        metadata: { model: mappedModel, prompt: prompt.slice(0, 100), jobId },
      }
    );

    await this.cloudTasksService.updateJobProgress(jobId, 25);

    let result: unknown;
    let lastError: unknown;
    const maxRetries = 3;

    const optionsDto =
      (data.options as Partial<ProviderGenerateDto> | undefined) ?? {};
    const generationDto = this.buildGenerationDto(
      prompt,
      mappedModel,
      optionsDto,
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await this.generationService.generateForModel(
          { authUserId: user.authUserId } as SanitizedUser,
          mappedModel,
          generationDto,
        );
        break;
      } catch (error) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        if (attempt === maxRetries || !isRetryable) {
          // Auto-refund credits on final failure
          try {
            await this.paymentsService.refundCredits(
              user.authUserId,
              1,
              `Job generation failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`
            );
            this.logger.log(
              `Refunded 1 credit to user ${user.authUserId} due to job generation failure`
            );
          } catch (refundError) {
            this.logger.error(
              `Failed to refund credits to user ${user.authUserId}:`,
              refundError
            );
          }
          throw error;
        }

        this.logger.warn(`Generation attempt ${attempt} failed, retrying...`, {
          jobId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          isRetryable,
        });

        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000),
        );
      }
    }

    if (!result) {
      // Auto-refund credits if no result after all attempts
      try {
        await this.paymentsService.refundCredits(
          user.authUserId,
          1,
          `Job generation failed - no result after all attempts`
        );
        this.logger.log(
          `Refunded 1 credit to user ${user.authUserId} due to job generation failure - no result`
        );
      } catch (refundError) {
        this.logger.error(
          `Failed to refund credits to user ${user.authUserId}:`,
          refundError
        );
      }

      if (lastError instanceof Error) {
        throw lastError;
      }

      const fallbackMessage =
        typeof lastError === 'string' && lastError
          ? lastError
          : 'Generation failed after all retry attempts';

      throw new Error(fallbackMessage);
    }

    this.logger.log(
      `Generation result for job ${jobId}:`,
      JSON.stringify(result, null, 2),
    );

    await this.cloudTasksService.updateJobProgress(jobId, 75);

    const { fileUrl, mimeType, r2FileId } = this.extractResultAsset(result);

    // Ensure we have an R2 URL, not base64 data
    if (fileUrl.startsWith('data:image/')) {
      throw new Error(
        'R2 upload failed - base64 data detected instead of R2 URL. Please ensure R2 is properly configured.',
      );
    }

    let r2File = r2FileId
      ? await this.r2FilesService.findById(user.authUserId, r2FileId)
      : null;

    if (!r2File) {
      r2File = await this.r2FilesService.create(user.authUserId, {
        fileName: `generated-${Date.now()}.png`,
        fileUrl,
        mimeType,
        prompt,
        model,
      });
    }

    await this.usageService.recordGeneration(
      { authUserId: user.authUserId } as SanitizedUser,
      {
        provider,
        model,
        prompt,
        cost: 1,
      },
    );

    await this.cloudTasksService.completeJob(jobId, r2File.fileUrl, {
      r2FileId: r2File.id,
      fileUrl: r2File.fileUrl,
      prompt,
      model,
    });
  }

  private async processVideoGeneration(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const prompt = data.prompt as string;
    const model = data.model as string;
    const provider = data.provider as string;

    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
      5,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    await this.cloudTasksService.updateJobProgress(jobId, 25);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await this.cloudTasksService.updateJobProgress(jobId, 75);

    const videoUrl = `https://example.com/video-${Date.now()}.mp4`;

    await this.usageService.recordGeneration(
      { authUserId: userId } as SanitizedUser,
      {
        provider,
        model,
        prompt,
        cost: 5,
      },
    );

    await this.cloudTasksService.completeJob(jobId, videoUrl, {
      videoUrl,
      prompt,
      model,
      provider,
    });
  }

  private async processImageUpscale(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const imageUrl = data.imageUrl as string;
    const model = data.model as string;
    const provider = data.provider as string;

    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
      2,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    await this.cloudTasksService.updateJobProgress(jobId, 25);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await this.cloudTasksService.updateJobProgress(jobId, 75);

    const upscaledUrl = `https://example.com/upscaled-${Date.now()}.png`;

    await this.usageService.recordGeneration(
      { authUserId: userId } as SanitizedUser,
      {
        provider,
        model,
        prompt: `Upscale ${imageUrl}`,
        cost: 2,
      },
    );

    await this.cloudTasksService.completeJob(jobId, upscaledUrl, {
      upscaledUrl,
      sourceImageUrl: imageUrl,
      model,
      provider,
    });
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
    const options =
      (data.options as Partial<ProviderGenerateDto> | undefined) ?? {};

    const totalCost = prompts.length * 1;
    const hasCredits = await this.usageService.checkCredits(
      { authUserId: userId } as SanitizedUser,
      totalCost,
    );

    if (!hasCredits) {
      throw new Error('Insufficient credits');
    }

    await this.cloudTasksService.updateJobProgress(jobId, 10);

    const results: string[] = [];
    const totalPrompts = prompts.length;

    for (let i = 0; i < prompts.length; i += batchSize) {
      const batch = prompts.slice(i, i + batchSize);

      for (const prompt of batch) {
        try {
          const generationDto = this.buildGenerationDto(prompt, model, options);
          const result = await this.generationService.generateForModel(
            { authUserId: userId } as SanitizedUser,
            model,
            generationDto,
          );

          const { fileUrl, mimeType, r2FileId } =
            this.extractResultAsset(result);

          // Ensure we have an R2 URL, not base64 data
          if (fileUrl.startsWith('data:image/')) {
            throw new Error(
              `R2 upload failed for prompt "${prompt}" - base64 data detected instead of R2 URL. Please ensure R2 is properly configured.`,
            );
          }

          let r2File = r2FileId
            ? await this.r2FilesService.findById(userId, r2FileId)
            : null;

          if (!r2File) {
            r2File = await this.r2FilesService.create(userId, {
              fileName: `batch-generated-${Date.now()}-${i}.png`,
              fileUrl,
              mimeType,
              prompt,
              model,
            });
          }

          results.push(r2File.fileUrl);

          await this.usageService.recordGeneration(
            { authUserId: userId } as SanitizedUser,
            { provider, model, prompt, cost: 1 },
          );
        } catch (error) {
          this.logger.error(
            `Failed to process prompt "${prompt}" in batch:`,
            error,
          );
        }
      }

      const progress = Math.min(90, 10 + ((i + batchSize) / totalPrompts) * 80);
      await this.cloudTasksService.updateJobProgress(jobId, progress);
    }

    const resultUrl = JSON.stringify({ results, count: results.length });
    await this.cloudTasksService.completeJob(jobId, resultUrl, {
      results,
      resultCount: results.length,
      model,
      provider,
    });
  }

  private extractResultAsset(result: unknown) {
    if (!result || typeof result !== 'object') {
      throw new Error(
        `Cannot extract file URL from result: ${JSON.stringify(result)}`,
      );
    }

    const resultObj = result as Record<string, unknown>;

    const pickString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;
    const pickKey = (
      obj: Record<string, unknown>,
      key: string,
    ): string | undefined => pickString(obj[key]);

    let fileUrl: string | undefined;
    let mimeType: string | undefined;
    let r2FileId: string | undefined;

    const applyCandidate = (candidate?: {
      url?: string;
      mime?: string;
      r2Id?: string;
    }) => {
      if (!candidate) {
        return;
      }
      if (!fileUrl && candidate.url) {
        fileUrl = candidate.url;
      }
      if (!mimeType && candidate.mime) {
        mimeType = candidate.mime;
      }
      if (!r2FileId && candidate.r2Id) {
        r2FileId = candidate.r2Id;
      }
    };

    const extractFromPayload = (payload: Record<string, unknown>) => {
      applyCandidate({
        url:
          pickKey(payload, 'r2FileUrl') ??
          pickKey(payload, 'dataUrl') ??
          pickKey(payload, 'image') ??
          pickKey(payload, 'image_url'),
        mime:
          pickKey(payload, 'mimeType') ??
          pickKey(payload, 'contentType') ??
          pickKey(payload, 'type'),
        r2Id: pickKey(payload, 'r2FileId'),
      });
    };

    const extractFromAsset = (asset: Record<string, unknown>) => {
      applyCandidate({
        url:
          pickKey(asset, 'r2FileUrl') ??
          pickKey(asset, 'remoteUrl') ??
          pickKey(asset, 'dataUrl'),
        mime: pickKey(asset, 'mimeType'),
        r2Id: pickKey(asset, 'r2FileId'),
      });
    };

    if ('clientPayload' in resultObj) {
      const payload = resultObj.clientPayload;
      if (payload && typeof payload === 'object') {
        extractFromPayload(payload as Record<string, unknown>);
      }
    }

    if (
      'assets' in resultObj &&
      Array.isArray(resultObj.assets) &&
      resultObj.assets.length > 0
    ) {
      const firstAsset = resultObj.assets[0] as unknown;
      if (firstAsset && typeof firstAsset === 'object') {
        extractFromAsset(firstAsset as Record<string, unknown>);
      }
    }

    applyCandidate({
      url:
        pickKey(resultObj, 'r2FileUrl') ??
        pickKey(resultObj, 'remoteUrl') ??
        pickKey(resultObj, 'dataUrl'),
      mime: pickKey(resultObj, 'mimeType') ?? pickKey(resultObj, 'contentType'),
      r2Id: pickKey(resultObj, 'r2FileId'),
    });

    if (!fileUrl) {
      const resultStr = JSON.stringify(resultObj);
      const urlMatch = resultStr.match(/https?:\/\/[^\s"']+/);
      if (urlMatch) {
        fileUrl = urlMatch[0];
      }
    }

    if (!fileUrl) {
      throw new Error(
        `Cannot extract file URL from result: ${JSON.stringify(result)}`,
      );
    }

    return {
      fileUrl,
      mimeType: mimeType ?? 'image/jpeg',
      r2FileId,
    };
  }

  private mapQueueModelToGenerationModel(model: string): string {
    const modelMappings: Record<string, string> = {
      'gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
      'flux-1.1': 'flux-pro-1.1',
      'flux-pro-1.1': 'flux-pro-1.1',
      'flux-pro-1.1-ultra': 'flux-pro-1.1-ultra',
      'flux-kontext-pro': 'flux-kontext-pro',
      'flux-kontext-max': 'flux-kontext-max',
      'flux-pro': 'flux-pro',
      'flux-dev': 'flux-dev',
      'reve-image': 'reve-image',
      'reve-image-1.0': 'reve-image-1.0',
      'reve-v1': 'reve-v1',
      recraft: 'recraft-v3',
      'recraft-v2': 'recraft-v2',
      'recraft-v3': 'recraft-v3',
      'luma-photon-1': 'luma-photon-1',
      'luma-photon-flash-1': 'luma-photon-flash-1',
      'luma-dream-shaper': 'luma-dream-shaper',
      'luma-realistic-vision': 'luma-realistic-vision',
      ideogram: 'ideogram',
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
        '429',
        '502',
        '503',
        '504',
      ];

      return retryablePatterns.some((pattern) => message.includes(pattern));
    }

    return false;
  }

  private buildGenerationDto(
    prompt: string,
    model: string,
    overrides: Partial<ProviderGenerateDto>,
  ): ProviderGenerateDto {
    const dto: ProviderGenerateDto = {
      prompt,
      model,
      providerOptions: overrides.providerOptions ?? {},
    };

    if (overrides.imageBase64 !== undefined) {
      dto.imageBase64 = overrides.imageBase64;
    }
    if (overrides.mimeType !== undefined) {
      dto.mimeType = overrides.mimeType;
    }
    if (overrides.references !== undefined) {
      dto.references = overrides.references;
    }
    if (overrides.temperature !== undefined) {
      dto.temperature = overrides.temperature;
    }
    if (overrides.outputLength !== undefined) {
      dto.outputLength = overrides.outputLength;
    }
    if (overrides.topP !== undefined) {
      dto.topP = overrides.topP;
    }

    return dto;
  }
}
