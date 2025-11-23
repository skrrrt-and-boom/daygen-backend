import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { GenerationService } from '../generation/generation.service';
import { GenerationOrchestrator } from '../generation/generation.orchestrator';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { CloudTasksService } from './cloud-tasks.service';
import { LoggerService } from '../common/logger.service';
import { MetricsService } from '../common/metrics.service';
import { RequestContextService } from '../common/request-context.service';
import type { SanitizedUser } from '../users/types';
import type { ProviderGenerateDto } from '../generation/dto/base-generate.dto';
import { ScenesService, SceneGenerationJobPayload } from '../scenes/scenes.service';

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
    private readonly generationOrchestrator: GenerationOrchestrator,
    private readonly usageService: UsageService,
    private readonly paymentsService: PaymentsService,
    private readonly structuredLogger: LoggerService,
    private readonly metricsService: MetricsService,
    private readonly requestContext: RequestContextService,
    @Inject(forwardRef(() => CloudTasksService))
    private readonly cloudTasksService: CloudTasksService,
    @Inject(forwardRef(() => ScenesService))
    private readonly scenesService: ScenesService,
  ) { }

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
        case JobType.SCENE_GENERATION:
          await this.processSceneGeneration(jobId, userId, data);
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
              const normalizeResponseField = (value: unknown): string | null => {
                if (typeof value === 'string') {
                  const trimmed = value.trim();
                  return trimmed.length > 0 ? trimmed : null;
                }
                if (Array.isArray(value)) {
                  const combined = value
                    .map((entry) =>
                      typeof entry === 'string' ? entry.trim() : '',
                    )
                    .filter(Boolean)
                    .join('; ');
                  return combined.length > 0 ? combined : null;
                }
                if (value && typeof value === 'object') {
                  try {
                    return JSON.stringify(value);
                  } catch {
                    return null;
                  }
                }
                // Handle primitive types (number, boolean, symbol, bigint)
                if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'symbol' || typeof value === 'bigint') {
                  const text = String(value).trim();
                  return text.length > 0 ? text : null;
                }
                return null;
              };

              const responseMessage =
                normalizeResponseField(responseObj.message) ??
                normalizeResponseField(responseObj.error);
              const isGenericMessage =
                error.message === 'Http Exception' ||
                error.message === 'HttpException' ||
                error.message.trim().length === 0;

              if (responseMessage) {
                if (isGenericMessage || !errorMessage || errorMessage === 'Unknown error') {
                  errorMessage = responseMessage;
                } else if (!errorMessage.includes(responseMessage)) {
                  errorMessage = `${errorMessage}: ${responseMessage}`;
                }
              }

              const detailText = normalizeResponseField(responseObj.details);
              if (detailText) {
                errorMessage += ` (Details: ${detailText})`;
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

    // Orchestrator handles credit checks, deduction, retries, and persistence.
    // We just need to map the result to the job completion format.

    await this.cloudTasksService.updateJobProgress(jobId, 25);

    let result;
    try {
      result = await this.generationOrchestrator.generate(
        { authUserId: user.authUserId } as SanitizedUser,
        this.buildGenerationDto(prompt, mappedModel, (data.options as Partial<ProviderGenerateDto> | undefined) ?? {}),
        {
          cost: 1,
          retries: 3,
          isJob: true,
        },
      );
    } catch (error) {
      // Orchestrator already handled refunds and logging.
      // We just need to rethrow so the job fails.
      throw error;
    }

    await this.cloudTasksService.updateJobProgress(jobId, 75);

    const firstAsset = result.assets[0];
    if (!firstAsset) {
      throw new Error('No assets generated');
    }

    const fileUrl = firstAsset.remoteUrl || firstAsset.dataUrl;
    const r2FileId = firstAsset.r2FileId; // Assuming GeneratedAsset has r2FileId (it should if persisted)

    if (!fileUrl) {
      throw new Error('Generated asset has no URL');
    }

    await this.cloudTasksService.completeJob(jobId, fileUrl, {
      r2FileId,
      fileUrl,
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
    const cost = 5; // Video generation cost

    const user = await this.cloudTasksService.getUserByAuthId(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    const sanitizedUser = { authUserId: user.authUserId } as SanitizedUser;

    // 1. Reserve Credits
    const { reservationId } = await this.usageService.reserveCredits(sanitizedUser, {
      provider,
      model,
      prompt,
      cost,
      metadata: { model, prompt, jobId, type: 'video' },
    });

    try {
      await this.cloudTasksService.updateJobProgress(jobId, 25);

      // Simulate video generation (replace with actual provider call later)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await this.cloudTasksService.updateJobProgress(jobId, 75);

      const videoUrl = `https://example.com/video-${Date.now()}.mp4`;

      // 2. Capture Credits
      await this.usageService.captureCredits(reservationId, {
        finalStatus: 'COMPLETED',
        assetCount: 1,
      });

      await this.cloudTasksService.completeJob(jobId, videoUrl, {
        videoUrl,
        prompt,
        model,
        provider,
      });
    } catch (error) {
      // 3. Release Credits on Failure
      await this.usageService.releaseCredits(
        reservationId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async processImageUpscale(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const imageUrl = data.imageUrl as string;
    const model = data.model as string;
    const provider = data.provider as string;
    const cost = 2; // Upscale cost

    const user = await this.cloudTasksService.getUserByAuthId(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    const sanitizedUser = { authUserId: user.authUserId } as SanitizedUser;

    // 1. Reserve Credits
    const { reservationId } = await this.usageService.reserveCredits(sanitizedUser, {
      provider,
      model,
      prompt: `Upscale ${imageUrl}`,
      cost,
      metadata: { model, imageUrl, jobId, type: 'upscale' },
    });

    try {
      await this.cloudTasksService.updateJobProgress(jobId, 25);

      // Simulate upscale (replace with actual provider call later)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await this.cloudTasksService.updateJobProgress(jobId, 75);

      const upscaledUrl = `https://example.com/upscaled-${Date.now()}.png`;

      // 2. Capture Credits
      await this.usageService.captureCredits(reservationId, {
        finalStatus: 'COMPLETED',
        assetCount: 1,
      });

      await this.cloudTasksService.completeJob(jobId, upscaledUrl, {
        upscaledUrl,
        sourceImageUrl: imageUrl,
        model,
        provider,
      });
    } catch (error) {
      // 3. Release Credits on Failure
      await this.usageService.releaseCredits(
        reservationId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
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
          const result = await this.generationOrchestrator.generate(
            { authUserId: userId } as SanitizedUser,
            generationDto,
            {
              cost: 1,
              retries: 3,
              isJob: true,
            },
          );

          const firstAsset = result.assets[0];
          const fileUrl = firstAsset?.remoteUrl || firstAsset?.dataUrl;

          if (fileUrl) {
            results.push(fileUrl);
          } else {
            this.logger.warn(`Batch generation for prompt "${prompt}" completed but no URL found.`);
          }

          // Single charge per generated output should be handled centrally
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

  private async processSceneGeneration(
    jobId: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const userRecord = await this.cloudTasksService.getUserByAuthId(userId);
    if (!userRecord) {
      throw new Error(`User not found: ${userId}`);
    }

    const payload = this.parseSceneJobPayload(data);
    const sanitizedUser = { authUserId: userRecord.authUserId } as SanitizedUser;

    await this.cloudTasksService.updateJobProgress(jobId, 10, JobStatus.PROCESSING);

    try {
      const result = await this.scenesService.runQueuedSceneGeneration(sanitizedUser, payload);

      await this.cloudTasksService.updateJobProgress(jobId, 90);

      await this.cloudTasksService.completeJob(jobId, result.imageUrl, {
        r2FileId: result.r2FileId,
        fileUrl: result.imageUrl,
        prompt: result.prompt,
        template: result.template,
        provider: 'scene-placement',
        model: 'ideogram-remix',
        mimeType: result.mimeType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.cloudTasksService.failJob(jobId, message);
      throw error;
    }
  }

  private parseSceneJobPayload(data: Record<string, unknown>): SceneGenerationJobPayload {
    const dto = data.dto;
    const characterUpload = data.characterUpload;
    const sceneTemplate = data.sceneTemplate;

    if (!dto || !characterUpload || !sceneTemplate) {
      throw new Error('Invalid scene generation job payload.');
    }

    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const aspectRatio = typeof data.aspectRatio === 'string' ? data.aspectRatio : '1x1';
    const renderingSpeed = typeof data.renderingSpeed === 'string' ? data.renderingSpeed : 'DEFAULT';
    const stylePreset = typeof data.stylePreset === 'string' ? data.stylePreset : 'AUTO';
    const styleTypeRaw = data.styleType;
    const styleType =
      styleTypeRaw === 'REALISTIC' || styleTypeRaw === 'FICTION' ? styleTypeRaw : 'AUTO';

    return {
      dto: dto as SceneGenerationJobPayload['dto'],
      characterUpload: characterUpload as SceneGenerationJobPayload['characterUpload'],
      sceneTemplate: sceneTemplate as SceneGenerationJobPayload['sceneTemplate'],
      prompt,
      aspectRatio,
      renderingSpeed,
      stylePreset,
      styleType,
    };
  }



  private mapQueueModelToGenerationModel(model: string): string {
    const modelMappings: Record<string, string> = {
      'gemini-2.5-flash-image': 'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview': 'gemini-2.5-flash-image',
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
      'grok-2-image': 'grok-2-image',
      'grok-2-image-1212': 'grok-2-image-1212',
      'grok-2-image-latest': 'grok-2-image-latest',
      'runway-gen4': 'runway-gen4',
      'runway-gen4-turbo': 'runway-gen4-turbo',
      'chatgpt-image': 'chatgpt-image',
      'seedream-3.0': 'seedream-3.0',
    };

    return modelMappings[model] || model;
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
