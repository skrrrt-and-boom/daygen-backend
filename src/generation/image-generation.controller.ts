import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { ProviderGenerateDto } from './dto/base-generate.dto';

const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const FLUX_MODELS = new Set([
  'flux-pro-1.1',
  'flux-pro-1.1-ultra',
  'flux-kontext-pro',
  'flux-kontext-max',
  'flux-pro',
  'flux-dev',
]);

const RUNWAY_MODELS = new Set(['runway-gen4', 'runway-gen4-turbo']);
const RECRAFT_MODELS = new Set(['recraft-v3', 'recraft-v2']);
const LUMA_MODELS = new Set([
  'luma-photon-1',
  'luma-photon-flash-1',
  'luma-dream-shaper',
  'luma-realistic-vision',
]);

@UseGuards(JwtAuthGuard)
@Controller('image')
export class ImageGenerationController {
  constructor(
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  @Post('gemini')
  async generateGemini(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'gemini',
      'gemini-2.5-flash-image-preview',
    );
  }

  @Post('flux')
  async generateFlux(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'flux',
      'flux-pro-1.1',
      FLUX_MODELS,
    );
  }

  @Post('chatgpt')
  generateChatGpt(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'openai',
      'chatgpt-image',
    );
  }

  @Post('ideogram')
  async generateIdeogram(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(user, dto, 'ideogram', 'ideogram');
  }

  @Post('qwen')
  generateQwen(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(user, dto, 'qwen', 'qwen-image');
  }

  @Post('runway')
  generateRunway(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'runway',
      'runway-gen4',
      RUNWAY_MODELS,
    );
  }

  @Post('seedream')
  generateSeedream(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(user, dto, 'seedream', 'seedream-3.0');
  }

  @Post('reve')
  generateReve(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(user, dto, 'reve', 'reve-image');
  }

  @Post('recraft')
  generateRecraft(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'recraft',
      'recraft-v3',
      RECRAFT_MODELS,
    );
  }

  @Post('luma')
  generateLuma(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    return this.enqueueImageJob(
      user,
      dto,
      'luma',
      'luma-photon-1',
      LUMA_MODELS,
    );
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
    fallbackModel: string,
    allowedModels?: Set<string>,
  ) {
    const model = this.resolveModel(dto.model, fallbackModel, allowedModels);

    return this.cloudTasksService.createImageGenerationJob(user.authUserId, {
      prompt: dto.prompt,
      model,
      provider,
      options: dto,
    });
  }
}
