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
import { ProviderHttpService } from '../provider-http.service';
import {
  asArray,
  asString,
  buildHttpErrorPayload,
  optionalJsonRecord,
  stringifyUnknown,
} from '../utils/provider-helpers';

export class SeedreamImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'seedream';
  private readonly logger = new Logger(SeedreamImageAdapter.name);

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly assets: GeneratedAssetService,
    private readonly http: ProviderHttpService,
  ) { }

  canHandleModel(model: string): boolean {
    return model === 'seedream-3.0';
  }

  async generate(
    _user: SanitizedUser,
    dto: ProviderGenerateDto,
  ): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('Seedream API key not configured');
    }

    const providerOptions = dto.providerOptions ?? {};

    const response = await this.http.fetchWithTimeout(
      'https://ark.ap-southeast.bytepluses.com/api/v3/image/generate',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'seedream-v3',
          prompt: dto.prompt,
          width: providerOptions.width ?? 1024,
          height: providerOptions.height ?? 1024,
          num_images: providerOptions.n ?? 1,
        }),
      },
      20_000,
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = stringifyUnknown(resultPayload);
      this.logger.error(`Seedream API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `Seedream API error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const urls = this.extractSeedreamImages(resultPayload);
    if (urls.length === 0) {
      this.badRequest('No images returned from Seedream');
    }

    const results: NormalizedImageResult[] = [];
    for (const url of urls) {
      const remoteUrl = url.startsWith('data:') ? undefined : url;
      const ensured = await this.assets.ensureDataUrl(url);
      const asset = this.assets.assetFromDataUrl(ensured);
      results.push({
        url: asset.dataUrl!,
        mimeType: asset.mimeType,
        provider: this.providerName,
        model: 'seedream-v3',
        metadata: remoteUrl ? { remoteUrl } : undefined,
      });
    }

    return {
      results,
      clientPayload: { images: results.map((r) => r.url) },
      rawResponse: resultPayload,
    };
  }

  private extractSeedreamImages(result: unknown): string[] {
    const images: string[] = [];
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return images;
    }

    for (const entry of asArray(resultRecord['data'])) {
      if (typeof entry === 'string') {
        images.push(entry);
        continue;
      }
      const entryRecord = optionalJsonRecord(entry);
      if (!entryRecord) {
        continue;
      }
      const b64 = asString(entryRecord['b64_json']);
      if (b64) {
        images.push(`data:image/png;base64,${b64}`);
      }
      const url = asString(entryRecord['url']);
      if (url) {
        images.push(url);
      }
    }

    for (const url of asArray(resultRecord['images'])) {
      if (typeof url === 'string') {
        images.push(url);
      }
    }

    return images;
  }

  private badRequest(message: string, details?: unknown): never {
    throw new HttpException(
      buildHttpErrorPayload(message, details),
      HttpStatus.BAD_REQUEST,
    );
  }
}

