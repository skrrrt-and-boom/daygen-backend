import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
  UploadedFile,
  UseInterceptors,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { ProviderGenerateDto } from './dto/base-generate.dto';
import { GenerationService } from './generation.service';
import { GenerationOrchestrator } from './generation.orchestrator';
import { PROVIDER_ROUTES } from './generation.router-config';

const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@UseGuards(JwtAuthGuard)
@Controller('image')
export class ImageGenerationController {
  constructor(
    private readonly cloudTasksService: CloudTasksService,
    private readonly generationService: GenerationService,
    private readonly generationOrchestrator: GenerationOrchestrator,
  ) { }

  @Post('recraft/variate')
  @UseInterceptors(FileInterceptor('file'))
  async variateRecraftImage(
    @CurrentUser() user: SanitizedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      size?: string;
      image_format?: 'png' | 'webp';
      n?: number;
      prompt?: string;
      model?: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const normalizedPrompt = body.prompt?.trim();
    const normalizedModel = body.model?.trim();

    return this.generationService.variateRecraftImage(user, {
      file,
      size: body.size || '1024x1024',
      image_format: body.image_format || 'webp',
      n: body.n || 1,
      prompt: normalizedPrompt && normalizedPrompt.length > 0 ? normalizedPrompt : undefined,
      model: normalizedModel && normalizedModel.length > 0 ? normalizedModel : undefined,
    });
  }

  @Post(':provider')
  async generate(
    @Param('provider') provider: string,
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const config = PROVIDER_ROUTES[provider];
    if (!config) {
      throw new NotFoundException(`Unknown provider: ${provider}`);
    }

    // Resolve model
    const model = this.resolveModel(
      dto.model,
      config.defaultModel,
      config.allowedModels,
    );

    // Special handling for Gemini inline/queue logic
    if (config.allowInline && !this.shouldQueue(dto)) {
      let finalModel = model;
      if (provider === 'gemini' && model === 'gemini-2.5-flash-image-preview') {
        finalModel = 'gemini-2.5-flash-image';
      }

      if (provider === 'gemini' && finalModel !== 'gemini-2.5-flash-image') {
        throw new BadRequestException(`Unsupported Gemini model: ${model}`);
      }

      const providerOptions = { ...(dto.providerOptions ?? {}) };
      delete providerOptions.useQueue;
      delete providerOptions.queue;
      delete providerOptions.forceQueue;
      delete providerOptions.useInline;
      delete providerOptions.inline;

      return this.generationOrchestrator.generate(
        user,
        {
          ...dto,
          model: finalModel,
          providerOptions,
        },
      );
    }

    return this.enqueueImageJob(user, dto, provider, model);
  }

  private resolveModel(
    requested: string | undefined,
    fallback: string,
    allowed?: Set<string>,
  ) {
    const candidate = (requested ?? fallback).trim();
    if (!candidate) {
      throw new BadRequestException('Model is required');
    }

    if (allowed && !allowed.has(candidate)) {
      throw new BadRequestException(`Unsupported model: ${candidate}`);
    }

    return candidate;
  }

  private enqueueImageJob(
    user: SanitizedUser,
    dto: ProviderGenerateDto,
    provider: string,
    model: string,
  ) {
    return this.cloudTasksService.createImageGenerationJob(user.authUserId, {
      prompt: dto.prompt,
      model,
      provider,
      options: dto,
    });
  }

  private shouldQueue(dto: ProviderGenerateDto): boolean {
    const rawOptions = dto.providerOptions ?? {};
    const queueFlags = [
      rawOptions.useQueue,
      rawOptions.queue,
      rawOptions.forceQueue,
    ];

    for (const flag of queueFlags) {
      if (typeof flag === 'boolean') {
        return flag;
      }
    }

    const inlineFlags = [rawOptions.useInline, rawOptions.inline];
    for (const flag of inlineFlags) {
      if (typeof flag === 'boolean') {
        return !flag;
      }
    }

    return true;
  }
}
