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
      },
    );

    return { jobId, status: 'queued', provider: 'sora', model: body.model?.trim() || 'sora-2' };
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

    return normalized;
  }
}
