import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { GEMINI_API_KEY_CANDIDATES } from './constants';

type ProviderOptions = Record<string, unknown>;

@UseGuards(JwtAuthGuard)
@Controller('video')
export class VideoGenerationController {
  constructor(
    private readonly configService: ConfigService,
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  @Post('sora')
  async generateSoraVideo(
    @CurrentUser() user: SanitizedUser,
    @Body()
    body: {
      prompt?: string;
      model?: string;
      providerOptions?: ProviderOptions;
      avatarId?: string;
      avatarImageId?: string;
      productId?: string;
    },
  ) {
    const prompt = body.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required for Sora video generation.');
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new HttpException('OpenAI API key is not configured', HttpStatus.BAD_GATEWAY);
    }

    const providerOptions = this.normalizeProviderOptions(body.providerOptions);

    const { jobId } = await this.cloudTasksService.createVideoGenerationJob(
      user.authUserId,
      {
        prompt,
        model: body.model?.trim() || 'sora-2',
        provider: 'sora',
        options: providerOptions,
        avatarId: typeof body.avatarId === 'string' ? body.avatarId.trim() : undefined,
        avatarImageId: typeof body.avatarImageId === 'string' ? body.avatarImageId.trim() : undefined,
        productId: typeof body.productId === 'string' ? body.productId.trim() : undefined,
      },
    );

    return { jobId, status: 'queued', provider: 'sora', model: body.model?.trim() || 'sora-2' };
  }

  @Post('veo')
  async generateVeoVideo(
    @CurrentUser() user: SanitizedUser,
    @Body()
    body: {
      prompt?: string;
      model?: string;
      providerOptions?: ProviderOptions;
      imageUrls?: string[];
      references?: string[];
      avatarId?: string;
      avatarImageId?: string;
      productId?: string;
    },
  ) {
    const prompt = body.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required for Veo video generation.');
    }

    const apiKey = this.findGeminiApiKey();
    if (!apiKey) {
      throw new HttpException('Gemini API key is not configured', HttpStatus.BAD_GATEWAY);
    }

    const providerOptions = this.normalizeProviderOptions(body.providerOptions);
    const model = body.model?.trim() || 'veo-3.1-generate-preview';
    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.filter(
        (url): url is string => typeof url === 'string' && url.trim().length > 0,
      )
      : undefined;
    const references = Array.isArray(body.references)
      ? body.references
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
        .slice(0, 3)
      : undefined;

    const { jobId } = await this.cloudTasksService.createVideoGenerationJob(
      user.authUserId,
      {
        prompt,
        model,
        provider: 'veo',
        options: providerOptions,
        imageUrls,
        references,
        avatarId: typeof body.avatarId === 'string' ? body.avatarId.trim() : undefined,
        avatarImageId: typeof body.avatarImageId === 'string' ? body.avatarImageId.trim() : undefined,
        productId: typeof body.productId === 'string' ? body.productId.trim() : undefined,
      },
    );

    return { jobId, status: 'queued', provider: 'veo', model };
  }

  private normalizeProviderOptions(rawOptions: unknown): Record<string, unknown> {
    const options = (rawOptions && typeof rawOptions === 'object'
      ? (rawOptions as ProviderOptions)
      : {});

    const normalized: Record<string, unknown> = {};

    if (typeof options.aspect_ratio === 'string') {
      normalized.aspect_ratio = options.aspect_ratio.trim();
    }
    if (typeof options.duration === 'number') {
      normalized.duration = options.duration;
    }
    if (typeof options.format === 'string') {
      normalized.format = options.format.trim();
    }
    if (typeof options.with_sound === 'boolean') {
      normalized.with_sound = options.with_sound;
    }
    if (typeof options.seed === 'number') {
      normalized.seed = options.seed;
    }
    if (typeof options.negative_prompt === 'string') {
      normalized.negative_prompt = options.negative_prompt.trim();
    }
    if (typeof options.image_base64 === 'string') {
      normalized.image_base64 = options.image_base64.trim();
    }
    if (typeof options.image_mime_type === 'string') {
      normalized.image_mime_type = options.image_mime_type.trim();
    }
    if (typeof options.resolution === 'string') {
      normalized.resolution = options.resolution.trim();
    }
    if (typeof options.person_generation === 'string') {
      normalized.person_generation = options.person_generation.trim();
    }

    return normalized;
  }

  private findGeminiApiKey(): string | null {
    for (const key of GEMINI_API_KEY_CANDIDATES) {
      const value = this.configService.get<string>(key);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }
}
