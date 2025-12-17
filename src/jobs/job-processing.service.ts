import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { R2Service } from '../upload/r2.service';
import { R2FilesService } from '../r2files/r2files.service';
import { GEMINI_API_KEY_CANDIDATES } from '../generation/constants';
import { AudioService } from '../audio/audio.service';
import Replicate from 'replicate';
import sharp from 'sharp';

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
    @Inject(forwardRef(() => CloudTasksService))
    private readonly cloudTasksService: CloudTasksService,
    @Inject(forwardRef(() => ScenesService))
    private readonly scenesService: ScenesService,
    private readonly structuredLogger: LoggerService,
    private readonly metricsService: MetricsService,
    private readonly requestContext: RequestContextService,
    private readonly configService: ConfigService,
    private readonly r2Service: R2Service,
    private readonly r2FilesService: R2FilesService,
    private readonly audioService: AudioService,
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
        case JobType.IMAGE_RESIZE: // Resize uses same processing as image generation
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
    const provider = (data.provider as string)?.trim().toLowerCase();
    const cost = 5; // Video generation cost
    const avatarId = typeof data.avatarId === 'string' ? data.avatarId.trim() : undefined;
    const avatarImageId = typeof data.avatarImageId === 'string' ? data.avatarImageId.trim() : undefined;
    const productId = typeof data.productId === 'string' ? data.productId.trim() : undefined;

    const options = (data.options && typeof data.options === 'object' && !Array.isArray(data.options))
      ? (data.options as Record<string, unknown>)
      : undefined;

    const fallbackAspectRatio = (() => {
      const raw = options?.aspect_ratio ?? options?.aspectRatio;
      return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '16:9';
    })();

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
      await this.cloudTasksService.updateJobProgress(
        jobId,
        5,
        JobStatus.PROCESSING,
      );

      if (provider === 'veo') {
        const veoResult = await this.handleVeoVideoGeneration(
          jobId,
          prompt,
          model,
          options,
          data.imageUrls as string[] | undefined,
          data.references as string[] | undefined,
        );

        await this.usageService.captureCredits(reservationId, {
          finalStatus: 'COMPLETED',
          assetCount: 1,
        });

        const r2File = await this.r2FilesService.create(user.authUserId, {
          fileName: `veo-${Date.now()}.mp4`,
          fileUrl: veoResult.videoUrl,
          mimeType: 'video/mp4',
          prompt,
          model: veoResult.model,
          jobId,
          aspectRatio: veoResult.aspectRatio ?? fallbackAspectRatio,
          avatarId,
          avatarImageId,
          productId,
        });

        await this.cloudTasksService.completeJob(jobId, veoResult.videoUrl, {
          videoUrl: veoResult.videoUrl,
          provider: 'veo',
          model: veoResult.model,
          prompt,
          operationName: veoResult.operationName,
          aspectRatio: veoResult.aspectRatio,
          durationSeconds: veoResult.durationSeconds,
          resolution: veoResult.resolution,
          providerOptions: veoResult.providerOptions,
          referenceCount: veoResult.referenceCount,
          r2FileId: r2File.id,
        });

        return;
      }

      if (provider === 'sora') {
        const soraResult = await this.handleSoraVideoGeneration(
          jobId,
          prompt,
          model,
          options,
        );

        await this.usageService.captureCredits(reservationId, {
          finalStatus: 'COMPLETED',
          assetCount: 1,
        });

        const r2File = await this.r2FilesService.create(user.authUserId, {
          fileName: `sora-${Date.now()}.mp4`,
          fileUrl: soraResult.videoUrl,
          mimeType: 'video/mp4',
          prompt,
          model: soraResult.model,
          jobId,
          aspectRatio: fallbackAspectRatio,
          avatarId,
          avatarImageId,
          productId,
        });

        await this.cloudTasksService.completeJob(jobId, soraResult.videoUrl, {
          videoUrl: soraResult.videoUrl,
          provider: 'sora',
          model: soraResult.model,
          prompt,
          soraVideoId: soraResult.videoId,
          size: soraResult.size,
          seconds: soraResult.seconds,
          providerOptions: soraResult.providerOptions,
          r2FileId: r2File.id,
        });

        return;
      }

      if (provider === 'omnihuman') {
        // Required fields validated in controller
        const script = data.script as string;
        const voiceId = data.voiceId as string;
        const imageUrl = data.imageUrls && Array.isArray(data.imageUrls) ? data.imageUrls[0] : (data.imageUrl as string);

        if (!imageUrl) {
          throw new Error('Image URL is required for Omnihuman generation');
        }

        const omniResult = await this.handleOmnihumanVideoGeneration(
          jobId,
          prompt,
          script,
          voiceId,
          imageUrl,
        );

        await this.usageService.captureCredits(reservationId, {
          finalStatus: 'COMPLETED',
          assetCount: 1,
        });

        const r2File = await this.r2FilesService.create(user.authUserId, {
          fileName: `omnihuman-${Date.now()}.mp4`,
          fileUrl: omniResult.videoUrl,
          mimeType: 'video/mp4',
          prompt,
          model: omniResult.model,
          jobId,
          aspectRatio: fallbackAspectRatio,
          avatarId,
          avatarImageId,
          productId,
        });

        await this.cloudTasksService.completeJob(jobId, omniResult.videoUrl, {
          videoUrl: omniResult.videoUrl,
          provider: 'omnihuman',
          model: omniResult.model,
          prompt,
          script,
          voiceId,
          r2FileId: r2File.id,
        });

        return;
      }

      // Fallback placeholder for other providers (kept to avoid breaking existing flows)
      await this.cloudTasksService.updateJobProgress(jobId, 75);

      const videoUrl = `https://example.com/video-${Date.now()}.mp4`;

      await this.usageService.captureCredits(reservationId, {
        finalStatus: 'COMPLETED',
        assetCount: 1,
      });

      // Best-effort persist in gallery so UI doesn't lose metadata on refresh.
      const r2File = await this.r2FilesService.create(user.authUserId, {
        fileName: `video-${Date.now()}.mp4`,
        fileUrl: videoUrl,
        mimeType: 'video/mp4',
        prompt,
        model,
        jobId,
        aspectRatio: fallbackAspectRatio,
        avatarId,
        avatarImageId,
        productId,
      });

      await this.cloudTasksService.completeJob(jobId, videoUrl, {
        videoUrl,
        prompt,
        model,
        provider,
        r2FileId: r2File.id,
        aspectRatio: fallbackAspectRatio,
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

  private async handleOmnihumanVideoGeneration(
    jobId: string,
    prompt: string | undefined,
    script: string,
    voiceId: string,
    imageUrl: string,
  ): Promise<{
    videoUrl: string;
    model: string;
  }> {
    this.logger.log(`Starting Omnihuman generation for job ${jobId}`);

    // 1. Generate Audio via ElevenLabs
    const audioResult = await this.audioService.generateSpeech({
      text: script,
      voiceId: voiceId,
    });

    if (!audioResult.success) {
      throw new Error('Failed to generate speech for LipSync');
    }

    // 2. Upload Audio to R2 (Omnihuman needs a public URL)
    const audioUrl = await this.r2Service.uploadBase64Image(
      audioResult.audioBase64,
      'audio/mpeg', // generateSpeech returns mp3 usually, assume mpeg
      'generated-audio',
      `omnihuman-audio-${jobId}-${Date.now()}.mp3`
    );

    this.logger.log(`Audio generated and uploaded to ${audioUrl}`);

    await this.cloudTasksService.updateJobProgress(jobId, 20);

    // 3. Init Replicate
    const replicateToken = this.configService.get<string>('REPLICATE_API_TOKEN');
    if (!replicateToken) {
      throw new Error('REPLICATE_API_TOKEN not configured');
    }
    const replicate = new Replicate({ auth: replicateToken });

    // 4. Run Omnihuman
    const model = 'bytedance/omni-human-1.5';
    this.logger.log(`Calling Replicate model ${model}`);

    // We use predictions.create to poll for status if we want, or run() to block.
    // run() is simpler but might timeout for long generations if default timeout is short.
    // However, Replicate's run() polls internally.
    // Omnihuman can take some time.
    // Let's use run() for now, mirroring basic usage.
    const output = await replicate.run(
      model,
      {
        input: {
          image: imageUrl,
          audio: audioUrl,
          prompt: prompt || 'realistic', // prompt is optional but often helpful
        }
      }
    );

    await this.cloudTasksService.updateJobProgress(jobId, 90);

    // output is the video URL
    const replicateVideoUrl = (output as unknown) as string;
    this.logger.log(`Replicate generation completed. URL: ${replicateVideoUrl}`);

    // 5. Download and Persist Video
    const downloadResponse = await fetch(replicateVideoUrl);
    if (!downloadResponse.ok) {
      throw new Error('Failed to download generated video from Replicate');
    }
    const buffer = Buffer.from(await downloadResponse.arrayBuffer());

    const videoUrl = await this.r2Service.uploadBuffer(
      buffer,
      'video/mp4',
      'generated-videos',
      `omnihuman-${jobId}-${Date.now()}.mp4`
    );

    return {
      videoUrl,
      model
    };
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
      'gemini-3.0-pro-image': 'gemini-3.0-pro-image',
      'gemini-3.0-pro': 'gemini-3.0-pro-image',
      'gemini-3.0-pro-exp-01': 'gemini-3.0-pro-exp-01',
      'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview',
      'gemini-3-pro-image': 'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image': 'gemini-2.5-flash-image',
      'imagen-4.0-generate-001': 'imagen-4.0-generate-001',
      'imagen-4.0-fast-generate-001': 'imagen-4.0-fast-generate-001',
      'imagen-4.0-ultra-generate-001': 'imagen-4.0-ultra-generate-001',
      'imagen-3.0-generate-002': 'imagen-3.0-generate-002',
      'flux-2': 'flux-2-pro',
      'flux-2-pro': 'flux-2-pro',
      'flux-2-flex': 'flux-2-flex',
      // Legacy FLUX.1 models route to FLUX.2 equivalents
      'flux-1.1': 'flux-2-pro',
      'flux-pro-1.1': 'flux-2-pro',
      'flux-pro-1.1-ultra': 'flux-2-flex',
      'flux-kontext-pro': 'flux-2-pro',
      'flux-kontext-max': 'flux-2-flex',
      'flux-pro': 'flux-2-pro',
      'flux-dev': 'flux-2-pro',
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
      'gpt-image-1.5': 'gpt-image-1.5',
      'chatgpt-image': 'gpt-image-1.5',
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

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private parseNumeric(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const cleaned = value.trim().replace(/%$/, '');
      if (!cleaned) return undefined;
      const parsed = Number.parseFloat(cleaned);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private resolveGeminiApiKey(): string {
    for (const key of GEMINI_API_KEY_CANDIDATES) {
      const candidate = this.configService.get<string>(key);
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    throw new Error('Gemini API key is not configured');
  }

  private normalizeVeoAspectRatio(value: unknown): string | undefined {
    const text = this.pickString(value);
    if (!text) return undefined;

    const normalized = text.replace(/\s+/g, '');
    if (normalized === '16:9' || normalized === '9:16') {
      return normalized;
    }

    return undefined;
  }

  private normalizeVeoDurationSeconds(value: unknown): number | undefined {
    const parsed = this.parseNumeric(value);
    if (parsed === undefined) return undefined;
    if (parsed === 4 || parsed === 6 || parsed === 8) {
      return parsed;
    }
    return undefined;
  }

  private normalizeVeoSeed(value: unknown): number | undefined {
    const parsed = this.parseNumeric(value);
    if (parsed === undefined) return undefined;
    return Math.round(parsed);
  }

  private normalizeVeoResolution(value: unknown): string | undefined {
    const text = this.pickString(value);
    if (!text) return undefined;
    const normalized = text.toLowerCase();
    if (normalized === '720p' || normalized === '1080p') {
      return normalized;
    }
    return undefined;
  }

  private normalizePersonGeneration(value: unknown): string | undefined {
    const text = this.pickString(value)?.toLowerCase();
    if (!text) return undefined;
    if (['allow_all', 'allow_adult', 'dont_allow'].includes(text)) {
      return text;
    }
    return undefined;
  }

  private normalizeBase64(value: unknown): string | undefined {
    const text = this.pickString(value);
    if (!text) return undefined;
    return text.replace(/^data:[^;,]+;base64,/, '');
  }

  private normalizeMimeType(value: unknown): string | undefined {
    return this.pickString(value);
  }

  private async normalizeReferences(
    references?: string[],
  ): Promise<Array<{ data: string; mimeType?: string }>> {
    if (!Array.isArray(references)) return [];

    const normalized: Array<{ data: string; mimeType?: string }> = [];
    for (const entry of references) {
      if (normalized.length >= 3) break;
      const text = this.pickString(entry);
      if (!text) continue;

      // Handle base64 data URLs
      const mimeMatch = /^data:([^;]+);base64,/i.exec(text);
      if (mimeMatch) {
        const mimeType = mimeMatch[1];
        const data = this.normalizeBase64(text);
        if (data) {
          normalized.push({ data, mimeType });
        }
        continue;
      }

      // Handle HTTP/HTTPS URLs - download and convert to base64
      if (text.startsWith('http://') || text.startsWith('https://')) {
        try {
          const response = await fetch(text);
          if (!response.ok) {
            this.logger.warn(`Failed to download reference image: ${response.status} ${response.statusText}`);
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Data = buffer.toString('base64');
          const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
          normalized.push({ data: base64Data, mimeType: contentType });
        } catch (e) {
          this.logger.warn(`Failed to fetch reference image from URL: ${text}`, e);
        }
        continue;
      }

      // Fallback: try as raw base64
      const data = this.normalizeBase64(text);
      if (data) {
        normalized.push({ data, mimeType: undefined });
      }
    }

    return normalized;
  }

  /**
   * Center-crops an image to match the target aspect ratio.
   * This prevents letterboxing/pillarboxing when the input image has a different
   * aspect ratio than the target video output (e.g., 1:1 image to 16:9 video).
   */
  private async centerCropToAspectRatio(
    base64Data: string,
    mimeType: string,
    targetAspectRatio: string,
  ): Promise<{ data: string; mimeType: string }> {
    // Parse target aspect ratio (e.g., "16:9" -> 16/9)
    const [targetW, targetH] = targetAspectRatio.split(':').map(Number);
    if (!targetW || !targetH) {
      return { data: base64Data, mimeType };
    }
    const targetRatio = targetW / targetH;

    try {
      const inputBuffer = Buffer.from(base64Data, 'base64');
      const image = sharp(inputBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        this.logger.warn('Could not get image dimensions, skipping crop');
        return { data: base64Data, mimeType };
      }

      const currentRatio = metadata.width / metadata.height;

      // If aspect ratios are close enough (within 5%), skip cropping
      if (Math.abs(currentRatio - targetRatio) / targetRatio < 0.05) {
        this.logger.log('Image aspect ratio matches target, no crop needed');
        return { data: base64Data, mimeType };
      }

      let cropWidth: number;
      let cropHeight: number;
      let left: number;
      let top: number;

      if (currentRatio > targetRatio) {
        // Image is wider than target, crop the sides
        cropHeight = metadata.height;
        cropWidth = Math.round(metadata.height * targetRatio);
        left = Math.round((metadata.width - cropWidth) / 2);
        top = 0;
      } else {
        // Image is taller than target, crop top/bottom
        cropWidth = metadata.width;
        cropHeight = Math.round(metadata.width / targetRatio);
        left = 0;
        top = Math.round((metadata.height - cropHeight) / 2);
      }

      this.logger.log('Center-cropping image to match target aspect ratio', {
        originalDimensions: `${metadata.width}x${metadata.height}`,
        originalRatio: currentRatio.toFixed(2),
        targetAspectRatio,
        targetRatio: targetRatio.toFixed(2),
        cropDimensions: `${cropWidth}x${cropHeight}`,
        cropOffset: `left=${left}, top=${top}`,
      });

      const croppedBuffer = await image
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .toBuffer();

      const croppedBase64 = croppedBuffer.toString('base64');
      return { data: croppedBase64, mimeType };
    } catch (error) {
      this.logger.error('Failed to center-crop image, using original', error);
      return { data: base64Data, mimeType };
    }
  }

  private parseVeoProgress(payload: Record<string, unknown>): number | undefined {
    const metadata = this.asRecord(payload.metadata);
    if (!metadata) return undefined;
    return (
      this.parseNumeric(metadata.progressPercent) ??
      this.parseNumeric(metadata.progress) ??
      this.parseNumeric(metadata.percentComplete)
    );
  }

  private extractOperationError(payload: Record<string, unknown>): string | undefined {
    const error = (payload as { error?: unknown }).error;
    if (!error) return undefined;

    if (typeof error === 'string') {
      return this.pickString(error);
    }

    const record = this.asRecord(error);
    if (!record) return undefined;

    return this.pickString(record.message) ??
      this.pickString(record.status) ??
      this.pickString(record.code);
  }

  private extractVeoVideoUri(payload: Record<string, unknown>): string | undefined {
    const response = this.asRecord(payload.response);
    if (response) {
      const generateVideoResponse = this.asRecord(response.generateVideoResponse);
      if (generateVideoResponse) {
        const generatedSamples = generateVideoResponse.generatedSamples;
        if (Array.isArray(generatedSamples)) {
          for (const sample of generatedSamples) {
            const sampleRecord = this.asRecord(sample);
            if (!sampleRecord) continue;

            const video = this.asRecord(sampleRecord.video);
            const uri =
              this.pickString(video?.uri) ??
              this.pickString(sampleRecord.uri);

            if (uri) {
              return uri;
            }
          }
        }

        const generatedVideos = generateVideoResponse.generatedVideos;
        if (Array.isArray(generatedVideos)) {
          for (const entry of generatedVideos) {
            const videoRecord = this.asRecord(entry);
            if (!videoRecord) continue;
            const uri = this.pickString(videoRecord.uri) ??
              this.pickString(this.asRecord(videoRecord.video)?.uri);
            if (uri) {
              return uri;
            }
          }
        }
      }

      const directVideoUri =
        this.pickString((response.video as { uri?: unknown } | undefined)?.uri) ??
        this.pickString(response.videoUri);
      if (directVideoUri) {
        return directVideoUri;
      }
    }

    const result = this.asRecord((payload as { result?: unknown }).result);
    if (result) {
      const nested = this.extractVeoVideoUri(result);
      if (nested) {
        return nested;
      }
    }

    return undefined;
  }

  private async handleVeoVideoGeneration(
    jobId: string,
    prompt: string,
    model?: string,
    options?: Record<string, unknown>,
    _imageUrls?: string[],
    references?: string[],
  ): Promise<{
    videoUrl: string;
    model: string;
    operationName: string;
    aspectRatio?: string;
    durationSeconds?: number;
    resolution?: string;
    providerOptions?: Record<string, unknown>;
    referenceCount?: number;
  }> {
    void _imageUrls; // Remote image URLs are not yet supported for Veo requests

    const apiKey = this.resolveGeminiApiKey();
    const requestedModel = model?.trim() || 'veo-3.1-generate-preview';
    const baseUrl =
      this.configService.get<string>('GEMINI_API_BASE_URL')?.trim() ||
      'https://generativelanguage.googleapis.com/v1beta';

    const aspectRatio = this.normalizeVeoAspectRatio(options?.aspect_ratio ?? options?.aspectRatio);
    const negativePrompt = this.pickString(options?.negative_prompt ?? options?.negativePrompt);
    const durationSeconds = this.normalizeVeoDurationSeconds(
      options?.duration ?? options?.durationSeconds,
    );
    const seed = this.normalizeVeoSeed(options?.seed);
    const resolution = this.normalizeVeoResolution(options?.resolution);
    const personGeneration = this.normalizePersonGeneration(
      options?.person_generation ?? options?.personGeneration,
    );

    const imageBase64 = this.normalizeBase64(
      options?.image_base64 ?? options?.imageBase64,
    );
    const imageMimeType = this.normalizeMimeType(
      options?.image_mime_type ?? options?.imageMimeType,
    );

    const normalizedReferences = await this.normalizeReferences(references);
    const referenceImages = normalizedReferences.map((entry) => ({
      image: {
        bytesBase64Encoded: entry.data,
        mimeType: entry.mimeType || 'image/png',
      },
      referenceType: 'asset',
    }));
    const supportsReferenceImages =
      requestedModel === 'veo-3.1-generate-preview' ||
      requestedModel === 'veo-3.1-fast-generate-preview';
    const wantsReferenceImages = referenceImages.length > 0;

    // Reference images are only supported on the standard Veo 3.1 model.
    let veoModel = requestedModel;

    if (wantsReferenceImages) {
      if (!supportsReferenceImages) {
        this.logger.warn(
          `Reference images requested with unsupported model "${requestedModel}", switching to veo-3.1-generate-preview`,
        );
      }
      veoModel = 'veo-3.1-generate-preview';
    }

    // Sanity check: Veo 3.1 currently prevents using both Image-to-Video (intro image) AND reference images (style/character refs)
    // If we have an input image (imageBase64), we must drop the reference images to avoid INVALID_ARGUMENT error.
    if (imageBase64 && referenceImages.length > 0) {
      this.logger.warn(
        `Veo 3.1: Image-to-Video does not support additional reference images. Ignoring ${referenceImages.length} references to prefer input image.`,
      );
    }

    // Decide which mode we're in: image-to-video vs text-to-video with references
    const useImageToVideo = Boolean(imageBase64);
    const hasReferenceImages = !useImageToVideo && referenceImages.length > 0;
    let appliedReferences = hasReferenceImages ? referenceImages : [] as typeof referenceImages;

    // Determine effective aspect ratio early so we can pre-crop images
    const effectiveAspectRatio = aspectRatio ?? (hasReferenceImages ? '16:9' : undefined);

    // Pre-crop the input image to match the target aspect ratio (for image-to-video mode)
    // This prevents letterboxing/stretching when input has different aspect ratio (e.g., 1:1 to 16:9)
    let processedImageBase64 = imageBase64;
    let processedImageMimeType = imageMimeType || 'image/png';
    if (imageBase64 && effectiveAspectRatio) {
      const cropped = await this.centerCropToAspectRatio(
        imageBase64,
        processedImageMimeType,
        effectiveAspectRatio,
      );
      processedImageBase64 = cropped.data;
      processedImageMimeType = cropped.mimeType;
    }

    // Pre-crop reference images to match the target aspect ratio (for text-to-video with refs mode)
    // This ensures reference images don't cause stretching/distortion in output video
    if (hasReferenceImages && effectiveAspectRatio && appliedReferences.length > 0) {
      const processedReferences: typeof appliedReferences = [];
      for (const ref of appliedReferences) {
        const currentMime = ref.image.mimeType || 'image/png';
        const cropped = await this.centerCropToAspectRatio(
          ref.image.bytesBase64Encoded,
          currentMime,
          effectiveAspectRatio,
        );
        processedReferences.push({
          image: {
            bytesBase64Encoded: cropped.data,
            mimeType: cropped.mimeType,
          },
          referenceType: ref.referenceType,
        });
      }
      appliedReferences = processedReferences;
      this.logger.log(`Pre-cropped ${appliedReferences.length} reference image(s) to ${effectiveAspectRatio}`);
    }

    const instance: Record<string, unknown> = { prompt };
    if (processedImageBase64) {
      instance.image = {
        bytesBase64Encoded: processedImageBase64,
        mimeType: processedImageMimeType,
      };
    }

    const parameters: Record<string, unknown> = {};
    // effectiveAspectRatio is already determined above for pre-cropping
    const effectiveDurationSeconds = hasReferenceImages
      ? 8
      : typeof durationSeconds === 'number'
        ? durationSeconds
        : undefined;
    const effectivePersonGeneration = hasReferenceImages
      ? 'allow_adult'
      : personGeneration;

    if (effectiveAspectRatio) parameters.aspectRatio = effectiveAspectRatio;
    if (negativePrompt) parameters.negativePrompt = negativePrompt;
    if (typeof effectiveDurationSeconds === 'number') {
      parameters.durationSeconds = effectiveDurationSeconds;
    }
    if (typeof seed === 'number') parameters.seed = seed;
    if (resolution) parameters.resolution = resolution;
    if (effectivePersonGeneration) parameters.personGeneration = effectivePersonGeneration;
    // Note: We pre-cropped the image above, so no need for resizeMode parameter
    if (appliedReferences.length > 0) {
      instance.referenceImages = appliedReferences;
    }

    const requestBody: Record<string, unknown> = { instances: [instance] };
    if (Object.keys(parameters).length > 0) {
      requestBody.parameters = parameters;
    }

    this.logger.log('Veo Request Summary', {
      model: veoModel,
      aspectRatio: effectiveAspectRatio,
      durationSeconds: effectiveDurationSeconds,
      hasReferenceImages,
      referenceCount: appliedReferences.length,
      personGeneration: effectivePersonGeneration,
      resolution,
      preCropped: Boolean(imageBase64 && effectiveAspectRatio),
      hasInputImage: Boolean(instance.image),
    });

    const createResponse = await fetch(
      `${baseUrl}/models/${veoModel}:predictLongRunning`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => '');
      throw new Error(
        errorText?.trim() ||
        `Failed to start Veo generation (status ${createResponse.status})`,
      );
    }

    const createPayload = (await createResponse.json()) as Record<string, unknown>;
    const operationName = this.pickString(createPayload.name) ??
      this.pickString((createPayload.operation as { name?: unknown } | undefined)?.name) ??
      this.pickString((createPayload as { operationName?: unknown }).operationName);
    if (!operationName) {
      throw new Error('Veo did not return an operation name');
    }

    await this.cloudTasksService.updateJobProgress(jobId, 10, JobStatus.PROCESSING);

    const pollDeadline = Date.now() + 15 * 60 * 1000; // 15 minutes
    let lastProgress = 10;

    while (Date.now() < pollDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusResponse = await fetch(`${baseUrl}/${operationName}`, {
        headers: { 'x-goog-api-key': apiKey },
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text().catch(() => '');
        throw new Error(
          errorText?.trim() ||
          `Failed to poll Veo video status (status ${statusResponse.status})`,
        );
      }

      const statusPayload = (await statusResponse.json()) as Record<string, unknown>;
      const opError = this.extractOperationError(statusPayload);
      if (opError) {
        throw new Error(opError);
      }

      const progress = this.parseVeoProgress(statusPayload);
      if (typeof progress === 'number' && progress > lastProgress) {
        lastProgress = Math.min(95, Math.max(progress, lastProgress));
        await this.cloudTasksService.updateJobProgress(jobId, lastProgress, JobStatus.PROCESSING);
      } else if (lastProgress < 90) {
        lastProgress = Math.min(90, lastProgress + 5);
        await this.cloudTasksService.updateJobProgress(jobId, lastProgress, JobStatus.PROCESSING);
      }

      const done = statusPayload.done === true || statusPayload.done === 'true';
      if (done) {
        const videoUri = this.extractVeoVideoUri(statusPayload);
        if (!videoUri) {
          throw new Error('Veo did not return a video URI');
        }

        const downloadResponse = await fetch(videoUri, {
          headers: { 'x-goog-api-key': apiKey },
          redirect: 'follow',
        });

        if (!downloadResponse.ok) {
          const errorText = await downloadResponse.text().catch(() => '');
          throw new Error(
            errorText?.trim() ||
            `Failed to download Veo video content (status ${downloadResponse.status})`,
          );
        }

        const contentType =
          downloadResponse.headers.get('content-type')?.split(';')[0]?.trim() ??
          'video/mp4';
        const buffer = Buffer.from(await downloadResponse.arrayBuffer());

        const safeOperationName = operationName.replace(/[^\w.-]+/g, '_');
        const fileName = `${safeOperationName || 'veo-video'}-${Date.now()}.mp4`;

        const videoUrl = await this.r2Service.uploadBuffer(
          buffer,
          contentType,
          'generated-videos',
          fileName,
        );

        return {
          videoUrl,
          model: veoModel,
          operationName,
          aspectRatio: effectiveAspectRatio,
          durationSeconds: effectiveDurationSeconds,
          resolution,
          providerOptions: options,
          referenceCount: appliedReferences.length,
        };
      }
    }

    throw new Error('Timed out waiting for Veo video generation to complete');
  }

  private resolveSoraSize(options: Record<string, unknown> | undefined): string | undefined {
    if (!options) return undefined;

    const size = options.size;
    if (typeof size === 'string' && size.includes('x')) {
      return size;
    }

    const aspectRatio = options.aspect_ratio;
    if (typeof aspectRatio === 'string') {
      const normalized = aspectRatio.trim();
      if (normalized === '16:9') return '1280x720';
      if (normalized === '9:16') return '720x1280';
    }

    return undefined;
  }

  private resolveSoraSeconds(options: Record<string, unknown> | undefined): string | undefined {
    if (!options) return undefined;

    const seconds = options.seconds ?? options.duration;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return seconds.toString();
    }
    if (typeof seconds === 'string') {
      const trimmed = seconds.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  }

  private parseSoraProgress(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const cleaned = value.trim().replace(/%$/, '');
      const parsed = Number.parseFloat(cleaned);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private async handleSoraVideoGeneration(
    jobId: string,
    prompt: string,
    model: string,
    options?: Record<string, unknown>,
  ): Promise<{
    videoUrl: string;
    videoId: string;
    model: string;
    size?: string;
    seconds?: string;
    providerOptions?: Record<string, unknown>;
  }> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const soraModel = model?.trim() || 'sora-2';
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', soraModel);

    const seconds = this.resolveSoraSeconds(options);
    const size = this.resolveSoraSize(options);

    if (seconds) formData.append('seconds', seconds);
    if (size) formData.append('size', size);

    const createResponse = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => '');
      throw new Error(
        errorText?.trim() || `Failed to start Sora generation (status ${createResponse.status})`,
      );
    }

    const createPayload = (await createResponse.json()) as Record<string, unknown>;
    const videoId = typeof createPayload.id === 'string' ? createPayload.id : null;
    if (!videoId) {
      throw new Error('Sora did not return a video id');
    }

    await this.cloudTasksService.updateJobProgress(jobId, 10, JobStatus.PROCESSING);

    const pollDeadline = Date.now() + 10 * 60 * 1000; // 10 minutes
    let lastProgress = 10;

    while (Date.now() < pollDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusResponse = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text().catch(() => '');
        throw new Error(
          errorText?.trim() ||
          `Failed to poll Sora video status (status ${statusResponse.status})`,
        );
      }

      const statusPayload = (await statusResponse.json()) as Record<string, unknown>;
      const status = (statusPayload.status as string | undefined)?.toLowerCase();
      const progress = this.parseSoraProgress(statusPayload.progress);

      if (typeof progress === 'number' && progress > lastProgress) {
        lastProgress = Math.min(99, Math.max(progress, lastProgress));
        await this.cloudTasksService.updateJobProgress(
          jobId,
          lastProgress,
          JobStatus.PROCESSING,
        );
      }

      if (status === 'completed') {
        const contentResponse = await fetch(
          `https://api.openai.com/v1/videos/${videoId}/content`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );

        if (!contentResponse.ok) {
          const errorText = await contentResponse.text().catch(() => '');
          throw new Error(
            errorText?.trim() ||
            `Failed to download Sora video content (status ${contentResponse.status})`,
          );
        }

        const contentType =
          contentResponse.headers.get('content-type')?.split(';')[0]?.trim() ??
          'video/mp4';
        const buffer = Buffer.from(await contentResponse.arrayBuffer());

        const videoUrl = await this.r2Service.uploadBuffer(
          buffer,
          contentType,
          'generated-videos',
          `${videoId}.mp4`,
        );

        return {
          videoUrl,
          videoId,
          model: soraModel,
          size: (statusPayload.size as string | undefined) ?? size,
          seconds: (statusPayload.seconds as string | undefined) ?? seconds,
          providerOptions: options,
        };
      }

      if (status === 'failed') {
        const errorMessage =
          (statusPayload.error as string | undefined)?.trim() ||
          (statusPayload.failure_reason as string | undefined)?.trim() ||
          'Sora video generation failed';
        throw new Error(errorMessage);
      }
    }

    throw new Error('Timed out waiting for Sora video generation to complete');
  }
}
