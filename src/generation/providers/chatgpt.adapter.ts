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

export class ChatGptImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'openai';
  private readonly logger = new Logger(ChatGptImageAdapter.name);

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly assets: GeneratedAssetService,
    private readonly http: ProviderHttpService,
  ) { }

  canHandleModel(model: string): boolean {
    return model === 'chatgpt-image';
  }

  async generate(
    _user: SanitizedUser,
    dto: ProviderGenerateDto,
  ): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key not configured');
    }

    const providerOptions = dto.providerOptions ?? {};
    const response = await this.http.fetchWithTimeout(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: dto.prompt,
          n: 1,
          size: providerOptions.size ?? '1024x1024',
        }),
      },
      20_000,
    );

    const resultPayload = (await response.json()) as unknown;
    const resultRecord = optionalJsonRecord(resultPayload);
    if (!response.ok) {
      const details = stringifyUnknown(resultPayload);
      this.logger.error(`OpenAI API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `OpenAI API error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const url = this.extractOpenAiImage(resultPayload);
    if (!url) {
      this.badRequest('No image returned from OpenAI');
    }

    const dataUrl = await this.assets.ensureDataUrl(url);
    const asset = this.assets.assetFromDataUrl(dataUrl);

    const revisedPrompt = (() => {
      const dataEntries = asArray(resultRecord?.['data']);
      const first = optionalJsonRecord(dataEntries[0]);
      if (!first) {
        return undefined;
      }
      return asString(first['revised_prompt']);
    })();

    const results: NormalizedImageResult[] = [
      {
        url: asset.dataUrl!,
        mimeType: asset.mimeType,
        provider: this.providerName,
        model: 'dall-e-3',
      },
    ];

    return {
      results,
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        revisedPrompt: revisedPrompt ?? null,
      },
      rawResponse: resultPayload,
    };
  }

  private extractOpenAiImage(result: unknown): string | null {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return null;
    }
    const dataEntries = asArray(resultRecord['data']);
    const firstEntry = optionalJsonRecord(dataEntries[0]);
    if (firstEntry) {
      const b64 = asString(firstEntry['b64_json']);
      if (b64) {
        return `data:image/png;base64,${b64}`;
      }
      const url = asString(firstEntry['url']);
      if (url) {
        return url;
      }
    }
    return null;
  }

  private badRequest(message: string, details?: unknown): never {
    throw new HttpException(
      buildHttpErrorPayload(message, details),
      HttpStatus.BAD_REQUEST,
    );
  }
}

