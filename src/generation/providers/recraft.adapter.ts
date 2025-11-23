import {
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ImageProviderAdapter,
  NormalizedImageResult,
  ProviderAdapterResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import { GeneratedAssetService } from '../generated-asset.service';
import {
  buildHttpErrorPayload,
  stringifyUnknown,
} from '../utils/provider-helpers';

export class RecraftImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'recraft';
  private readonly logger = new Logger(RecraftImageAdapter.name);

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly assets: GeneratedAssetService,
  ) { }

  canHandleModel(model: string): boolean {
    return model === 'recraft-v2' || model === 'recraft-v3';
  }

  async generate(
    _user: SanitizedUser,
    dto: ProviderGenerateDto,
  ): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.error(
        'RECRAFT_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Recraft API key not configured. Please set RECRAFT_API_KEY environment variable.',
      );
    }

    const providerOptions = dto.providerOptions ?? {};
    const model = dto.model === 'recraft-v2' ? 'recraftv2' : 'recraftv3';
    const response = await fetch(
      'https://external.api.recraft.ai/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: dto.prompt,
          model,
          style: providerOptions.style ?? 'realistic_image',
          substyle: providerOptions.substyle,
          size: providerOptions.size ?? '1024x1024',
          n: providerOptions.n ?? 1,
          negative_prompt: providerOptions.negative_prompt,
          controls: providerOptions.controls,
          text_layout: providerOptions.text_layout,
          response_format: providerOptions.response_format ?? 'url',
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = stringifyUnknown(resultPayload);
      this.logger.error(`Recraft API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `Recraft API error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const urls = this.extractRecraftImages(resultPayload);
    if (urls.length === 0) {
      this.badRequest('No images returned from Recraft');
    }

    const results: NormalizedImageResult[] = [];
    for (const url of urls) {
      const ensured = await this.assets.ensureDataUrl(url);
      const asset = this.assets.assetFromDataUrl(ensured);
      results.push({
        url: asset.dataUrl!,
        mimeType: asset.mimeType,
        provider: this.providerName,
        model,
      });
    }

    return {
      results,
      clientPayload: { dataUrls: results.map((r) => r.url) },
      rawResponse: resultPayload,
    };
  }

  private extractRecraftImages(result: unknown): string[] {
    return this.assets.collectImageCandidates(result);
  }

  private badRequest(message: string, details?: unknown): never {
    throw new HttpException(
      buildHttpErrorPayload(message, details),
      HttpStatus.BAD_REQUEST,
    );
  }
}

