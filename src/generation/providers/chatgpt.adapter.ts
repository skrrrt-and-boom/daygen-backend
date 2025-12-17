import {
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';
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

type GptImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
type GptImageQuality = 'low' | 'medium' | 'high' | 'auto';
type GptImageBackground = 'auto' | 'transparent' | 'opaque';

export class ChatGptImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'openai';
  private readonly logger = new Logger(ChatGptImageAdapter.name);

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly assets: GeneratedAssetService,
    private readonly http: ProviderHttpService,
  ) { }

  canHandleModel(model: string): boolean {
    return model === 'gpt-image-1.5' || model === 'chatgpt-image';
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
    const references = dto.references ?? [];
    const size: GptImageSize = this.normalizeSize(providerOptions.size);
    const quality: GptImageQuality = this.normalizeQuality(providerOptions.quality);
    const background: GptImageBackground = this.normalizeBackground(providerOptions.background);

    let resultPayload: unknown;
    let response: Response;

    // Use edits endpoint if references are provided, otherwise use generations
    if (references.length > 0) {
      const editResult = await this.generateWithReferences(apiKey, dto.prompt, references, size, quality);
      response = editResult.response;
      resultPayload = editResult.payload;
    } else {
      const genResult = await this.generateImage(apiKey, dto.prompt, size, quality, background);
      response = genResult.response;
      resultPayload = genResult.payload;
    }

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

    const url = this.extractOpenAiImage(resultPayload, background === 'transparent');
    if (!url) {
      this.badRequest('No image returned from OpenAI');
    }

    const dataUrl = await this.assets.ensureDataUrl(url);
    const asset = this.assets.assetFromDataUrl(dataUrl);

    // Parse image dimensions from base64 data
    let width: number | undefined;
    let height: number | undefined;
    try {
      const base64Data = dataUrl.split(',')[1];
      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        const metadata = await sharp(buffer).metadata();
        width = metadata.width;
        height = metadata.height;
      }
    } catch (err) {
      this.logger.warn('Failed to parse image dimensions:', err);
    }

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
        model: 'gpt-image-1.5',
      },
    ];

    return {
      results,
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        revisedPrompt: revisedPrompt ?? null,
        width,
        height,
      },
      rawResponse: resultPayload,
    };
  }

  private async generateImage(
    apiKey: string,
    prompt: string,
    size: GptImageSize,
    quality: GptImageQuality,
    background: GptImageBackground,
  ): Promise<{ response: Response; payload: unknown }> {
    const response = await this.http.fetchWithTimeout(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-image-1.5',
          prompt,
          n: 1,
          size,
          quality,
          background,
        }),
      },
      120_000, // GPT Image 1.5 can take up to 2 minutes for complex prompts
    );

    const payload = (await response.json()) as unknown;
    return { response, payload };
  }

  private async generateWithReferences(
    apiKey: string,
    prompt: string,
    references: string[],
    size: GptImageSize,
    quality: GptImageQuality,
  ): Promise<{ response: Response; payload: unknown }> {
    // Build multipart form data for the edits endpoint
    const formData = new FormData();
    formData.append('model', 'gpt-image-1.5');
    formData.append('prompt', prompt);
    formData.append('n', '1');
    if (size !== 'auto') {
      formData.append('size', size);
    }
    if (quality !== 'auto') {
      formData.append('quality', quality);
    }
    // Use high input fidelity for reference images to preserve details
    formData.append('input_fidelity', 'high');

    // Convert reference URLs/data URLs to blobs and append as image[]
    for (let i = 0; i < Math.min(references.length, 5); i++) {
      const ref = references[i];
      const blob = await this.urlToBlob(ref);
      if (blob) {
        formData.append('image', blob, `reference_${i}.png`);
      }
    }

    const response = await this.http.fetchWithTimeout(
      'https://api.openai.com/v1/images/edits',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Note: Don't set Content-Type for FormData, browser sets it with boundary
        },
        body: formData,
      },
      120_000, // GPT Image 1.5 can take up to 2 minutes
    );

    const payload = (await response.json()) as unknown;
    return { response, payload };
  }

  private async urlToBlob(urlOrDataUrl: string): Promise<Blob | null> {
    try {
      if (urlOrDataUrl.startsWith('data:')) {
        // Parse data URL
        const match = urlOrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          return null;
        }
        const mimeType = match[1];
        const base64 = match[2];
        const binary = Buffer.from(base64, 'base64');
        return new Blob([binary], { type: mimeType });
      } else {
        // Fetch URL
        const response = await fetch(urlOrDataUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          this.logger.warn(`Failed to fetch reference image: ${response.status}`);
          return null;
        }
        return await response.blob();
      }
    } catch (err) {
      this.logger.warn(`Failed to convert reference to blob: ${err}`);
      return null;
    }
  }

  private normalizeSize(size: unknown): GptImageSize {
    const validSizes: GptImageSize[] = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
    if (typeof size === 'string' && validSizes.includes(size as GptImageSize)) {
      return size as GptImageSize;
    }
    return 'auto';
  }

  private normalizeQuality(quality: unknown): GptImageQuality {
    const validQualities: GptImageQuality[] = ['low', 'medium', 'high', 'auto'];
    if (typeof quality === 'string' && validQualities.includes(quality as GptImageQuality)) {
      return quality as GptImageQuality;
    }
    return 'auto';
  }

  private normalizeBackground(background: unknown): GptImageBackground {
    const validBackgrounds: GptImageBackground[] = ['auto', 'transparent', 'opaque'];
    if (typeof background === 'string' && validBackgrounds.includes(background as GptImageBackground)) {
      return background as GptImageBackground;
    }
    return 'auto';
  }

  private extractOpenAiImage(result: unknown, preferPng = false): string | null {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return null;
    }
    const dataEntries = asArray(resultRecord['data']);
    const firstEntry = optionalJsonRecord(dataEntries[0]);
    if (firstEntry) {
      const b64 = asString(firstEntry['b64_json']);
      if (b64) {
        const mimeType = preferPng ? 'image/png' : 'image/png';
        return `data:${mimeType};base64,${b64}`;
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

