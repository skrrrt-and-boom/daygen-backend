import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { GenerationService } from './generation.service';
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
  constructor(private readonly generationService: GenerationService) {}

  @Post('gemini')
  generateGemini(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(
      dto.model,
      'gemini-2.5-flash-image-preview',
    );
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('flux')
  generateFlux(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'flux-pro-1.1', FLUX_MODELS);
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('chatgpt')
  generateChatGpt(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'chatgpt-image');
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('ideogram')
  generateIdeogram(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'ideogram');
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('qwen')
  generateQwen(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'qwen-image');
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('runway')
  generateRunway(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'runway-gen4', RUNWAY_MODELS);
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('seedream')
  generateSeedream(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'seedream-3.0');
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('reve')
  generateReve(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'reve-image');
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('recraft')
  generateRecraft(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'recraft-v3', RECRAFT_MODELS);
    return this.generationService.generateForModel(user, model, dto);
  }

  @Post('luma')
  generateLuma(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: ProviderGenerateDto,
  ) {
    const model = this.resolveModel(dto.model, 'luma-photon-1', LUMA_MODELS);
    return this.generationService.generateForModel(user, model, dto);
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
}
