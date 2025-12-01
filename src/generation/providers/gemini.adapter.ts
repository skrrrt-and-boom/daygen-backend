import type { ImageProviderAdapter, ProviderAdapterResult, NormalizedImageResult } from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';

/**
 * Imagen image adapter using Google's Imagen API for reliable image generation.
 * Uses the dedicated Imagen models instead of Gemini's multimodal API to avoid NO_IMAGE errors.
 */
type NormalizedImageInput = { data: string; mimeType: string };

const normalizeImageInput = (
  value: string | undefined,
  defaultMime: string,
): NormalizedImageInput | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Handle Data URI
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex !== -1) {
      const header = trimmed.slice(0, commaIndex);
      const rawData = trimmed.slice(commaIndex + 1);

      const mimeMatch = header.match(/^data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : defaultMime;

      try {
        // Convert URL-safe to standard base64 just in case
        const standardBase64 = rawData.replace(/-/g, '+').replace(/_/g, '/');
        // Use Buffer to normalize base64 (ignores whitespace, handles padding)
        const buffer = Buffer.from(standardBase64, 'base64');
        const data = buffer.toString('base64');

        // Detect mime type from magic bytes
        let detectedMime: string | null = null;
        if (data.startsWith('/9j/')) {
          detectedMime = 'image/jpeg';
        } else if (data.startsWith('iVBORw0KGgo')) {
          detectedMime = 'image/png';
        } else if (data.startsWith('UklGR')) {
          detectedMime = 'image/webp';
        } else if (data.startsWith('AAAAZGZ0eXBoZWlj') || data.startsWith('AAAHGZnR5cGhlaWM')) {
          detectedMime = 'image/heic';
        }

        if (!detectedMime) {
          console.warn('Gemini Adapter: Unsupported image format detected in Data URI. Header:', data.substring(0, 20));
          return null;
        }

        console.log('Gemini Adapter Image Debug:', {
          declaredMime: mimeType,
          detectedMime,
          originalLength: rawData.length,
          processedLength: data.length,
          header: data.substring(0, 20)
        });

        return { data, mimeType: detectedMime };
      } catch (e) {
        console.error('Failed to normalize base64 data URI:', e);
        return null;
      }
    }
  }

  // If no data URI prefix, assume it might be raw base64 if it doesn't look like a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return null;
  }

  // Treat as raw base64
  try {
    const standardBase64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(standardBase64, 'base64');
    const data = buffer.toString('base64');

    // Detect mime type from magic bytes
    let mimeType: string | null = null;
    if (data.startsWith('/9j/')) {
      mimeType = 'image/jpeg';
    } else if (data.startsWith('iVBORw0KGgo')) {
      mimeType = 'image/png';
    } else if (data.startsWith('UklGR')) {
      mimeType = 'image/webp';
    } else if (data.startsWith('AAAAZGZ0eXBoZWlj') || data.startsWith('AAAHGZnR5cGhlaWM')) {
      mimeType = 'image/heic';
    }

    if (!mimeType) {
      console.warn('Gemini Adapter: Unsupported image format detected. Header:', data.substring(0, 20));
      return null;
    }

    return { data, mimeType };
  } catch {
    return null;
  }
};

export class GeminiImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'gemini';

  constructor(private readonly getApiKey: () => string | undefined) { }

  private maybeAttachApiKey(url: string, apiKey?: string): string {
    if (!apiKey) {
      return url;
    }

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const isGoogleHost =
        host.endsWith('googleapis.com') || host.endsWith('googleusercontent.com');

      if (isGoogleHost && !parsed.searchParams.has('key')) {
        parsed.searchParams.set('key', apiKey);
        return parsed.toString();
      }

      return url;
    } catch {
      return url;
    }
  }

  private async fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType?: string }> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
      return {
        base64: Buffer.from(buffer).toString('base64'),
        mimeType: mimeType || undefined,
      };
    } catch (error) {
      throw new Error(`Failed to download image from URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async normalizeReferenceInputs(
    refs: unknown,
    defaultMime: string,
  ): Promise<NormalizedImageInput[]> {
    if (!Array.isArray(refs) || refs.length === 0) return [];

    const normalized: NormalizedImageInput[] = [];
    for (const raw of refs) {
      if (normalized.length >= 14) break;
      if (typeof raw !== 'string') continue;

      const trimmed = raw.trim();
      if (!trimmed) continue;

      const inline = normalizeImageInput(trimmed, defaultMime);
      if (inline) {
        normalized.push(inline);
        continue;
      }

      // Fallback: treat http/https as a URL and download to base64
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const downloaded = await this.fetchImageAsBase64(trimmed);
        normalized.push({
          data: downloaded.base64,
          mimeType: downloaded.mimeType || defaultMime,
        });
        continue;
      }
    }

    return normalized;
  }

  canHandleModel(model: string): boolean {
    return model === 'gemini-3-pro-image-preview' || model === 'gemini-3.0-pro-image';
  }

  validateOptions(dto: ProviderGenerateDto): void {
    const badRequest = (msg: string) =>
      Object.assign(new Error(msg), { status: 400 });

    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));

    if (dto.temperature !== undefined) {
      if (typeof dto.temperature !== 'number' || !Number.isFinite(dto.temperature)) {
        throw badRequest('temperature must be a number');
      }
      const t = clamp(dto.temperature, 0, 2);
      if (t !== dto.temperature) {
        throw badRequest('temperature must be between 0 and 2');
      }
    }
    if (dto.topP !== undefined) {
      if (typeof dto.topP !== 'number' || !Number.isFinite(dto.topP)) {
        throw badRequest('topP must be a number');
      }
      if (dto.topP < 0 || dto.topP > 1) {
        throw badRequest('topP must be between 0 and 1');
      }
    }
    if (dto.outputLength !== undefined) {
      if (
        typeof dto.outputLength !== 'number' ||
        !Number.isFinite(dto.outputLength) ||
        !Number.isInteger(dto.outputLength)
      ) {
        throw badRequest('outputLength must be an integer');
      }
      if (dto.outputLength < 1 || dto.outputLength > 8192) {
        throw badRequest('outputLength must be between 1 and 8192');
      }
    }
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    // Map friendly IDs to the available Gemini/Imagen image models
    // Map friendly IDs to the available Gemini/Imagen image models
    const modelMap: Record<string, string> = {
      'gemini-3.0-pro-preview': 'gemini-3-pro-image-preview',
      'gemini-3.0-pro-image': 'gemini-3-pro-image-preview',
    };
    const requestedModel = dto.model?.trim();
    const primaryModel = requestedModel ? (modelMap[requestedModel] || requestedModel) : 'gemini-3-pro-image-preview';
    const modelCandidates = [primaryModel];

    const prompt = (dto.prompt ?? '').toString().trim();
    if (!prompt) {
      throw new Error('Prompt is required for Imagen image generation');
    }

    const references = await this.normalizeReferenceInputs(
      dto.references,
      dto.mimeType || 'image/png',
    );

    const baseImage = normalizeImageInput(
      typeof dto.imageBase64 === 'string' ? dto.imageBase64 : undefined,
      dto.mimeType || 'image/png',
    );

    // Build Imagen/Gemini image parameters from DTO
    const providerOptions = dto.providerOptions || {};
    const parameters: Record<string, unknown> = {
      sampleCount: 1, // Default to 1 image, can be 1-4
      outputOptions: {
        mimeType: dto.mimeType || 'image/png',
      },
    };

    // Map aspectRatio from providerOptions or config
    const aspectRatio = providerOptions.aspectRatio as string | undefined;
    if (aspectRatio && typeof aspectRatio === 'string') {
      // Gemini 3 Pro Image supports common aspect ratios like Imagen
      const validRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
      if (validRatios.includes(aspectRatio)) {
        parameters.aspectRatio = aspectRatio;
      }
    }

    // Map numberOfImages if provided
    const numberOfImages = providerOptions.numberOfImages as number | undefined;
    if (numberOfImages !== undefined && typeof numberOfImages === 'number') {
      const count = Math.max(1, Math.min(4, Math.floor(numberOfImages)));
      parameters.sampleCount = count;
    }

    // Map imageSize if provided (1K or 2K, only for Standard and Ultra models)
    const imageSize = providerOptions.imageSize as string | undefined;
    if (imageSize && (imageSize === '1K' || imageSize === '2K')) {
      parameters.sampleImageSize = imageSize;
    }

    // Map personGeneration if provided
    const personGeneration = providerOptions.personGeneration as string | undefined;
    if (personGeneration && typeof personGeneration === 'string') {
      const validOptions = ['dont_allow', 'allow_adult', 'allow_all'];
      if (validOptions.includes(personGeneration)) {
        parameters.personGeneration = personGeneration;
      }
    }

    const buildPredictPayload = () => {
      const referenceImages = references.length > 0
        ? references.map((entry) => ({
          image: {
            imageBytes: entry.data,
            mimeType: entry.mimeType,
          },
        }))
        : undefined;

      return {
        instances: [
          {
            prompt: prompt,
            ...(referenceImages ? { referenceImages } : {}),
          },
        ],
        parameters,
      };
    };

    const parsePrediction = (prediction: unknown) => {
      if (!prediction || typeof prediction !== 'object') return null;
      const obj = prediction as Record<string, unknown>;
      const imageBlock = obj.image && typeof obj.image === 'object'
        ? obj.image as Record<string, unknown>
        : null;

      const rawUrl =
        (typeof obj.url === 'string' && obj.url.trim()) ||
        (typeof obj.uri === 'string' && obj.uri.trim()) ||
        (imageBlock && typeof imageBlock.url === 'string' && imageBlock.url.trim()) ||
        (imageBlock && typeof imageBlock.uri === 'string' && imageBlock.uri.trim()) ||
        null;

      const base64 =
        (typeof obj.bytesBase64Encoded === 'string' && obj.bytesBase64Encoded.trim()) ||
        (imageBlock && typeof imageBlock.imageBytes === 'string' && imageBlock.imageBytes.trim()) ||
        null;

      const mime =
        (imageBlock && typeof imageBlock.mimeType === 'string' && imageBlock.mimeType.trim()) ||
        'image/png';

      if (base64) {
        const url = `data:${mime};base64,${base64}`;
        return { url, mimeType: mime };
      }

      if (!rawUrl) return null;

      return { url: this.maybeAttachApiKey(rawUrl, apiKey), mimeType: mime };
    };

    const tryGenerateContent = async (modelName: string) => {
      const parts: Array<Record<string, unknown>> = [{ text: prompt }];

      if (baseImage) {
        parts.push({
          inline_data: {
            mime_type: baseImage.mimeType,
            data: baseImage.data,
          },
        });
      } else if (dto.imageUrl) {
        // Download image if only URL is provided
        const downloaded = await this.fetchImageAsBase64(dto.imageUrl);
        parts.push({
          inline_data: {
            mime_type: dto.mimeType || downloaded.mimeType || 'image/png', // Prefer explicit mimeType, then response header
            data: downloaded.base64,
          },
        });
      }

      if (references) {
        for (const reference of references) {
          parts.push({
            inline_data: {
              mime_type: reference.mimeType,
              data: reference.data,
            },
          });
        }
      }

      const generationConfig: Record<string, unknown> = {};

      // Add imageConfig for image generation models (gemini-3-pro-image-preview)
      const isImageGenerationModel =
        modelName.includes('flash-image') ||
        modelName.includes('imagen-') ||
        modelName.includes('gemini-3.0-pro') ||
        modelName.includes('gemini-3-pro');

      if (isImageGenerationModel) {
        const imageConfig: Record<string, unknown> = {};

        // Map aspectRatio from providerOptions
        if (aspectRatio && typeof aspectRatio === 'string') {
          // Gemini Image supports common aspect ratios
          const validRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
          if (validRatios.includes(aspectRatio)) {
            imageConfig.aspectRatio = aspectRatio;
          }
        }

        // Map imageSize from providerOptions (1K, 2K, 4K)
        const imageSize = providerOptions.imageSize as string | undefined;
        if (imageSize && typeof imageSize === 'string') {
          const normalizedSize = imageSize.toUpperCase();
          if (normalizedSize === '1K' || normalizedSize === '2K' || normalizedSize === '4K') {
            imageConfig.imageSize = normalizedSize;
          }
        }

        if (Object.keys(imageConfig).length > 0) {
          generationConfig.imageConfig = imageConfig;
        }

        // Explicitly request image output to match the Gemini image generation API shape
        generationConfig.responseModalities = ['TEXT', 'IMAGE'];
      } else {
        // Only add standard generation config for non-image models
        if (dto.temperature !== undefined) generationConfig.temperature = dto.temperature;
        if (dto.topP !== undefined) generationConfig.topP = dto.topP;
        if (dto.outputLength !== undefined) generationConfig.maxOutputTokens = dto.outputLength;
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      // Remove role: 'user' as it can sometimes cause issues with specific models/endpoints
      const requestBody: Record<string, unknown> = { contents: [{ parts }] };
      if (Object.keys(generationConfig).length > 0) {
        requestBody.generationConfig = generationConfig;
      }

      console.log('Gemini Adapter Debug:', {
        endpoint,
        modelName,
        requestBody: JSON.stringify(requestBody, null, 2),
        apiKeyPresent: !!apiKey
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error: Error & { status?: number; details?: string } = new Error(
          `Gemini image API error ${response.status}: ${text}`,
        );
        error.status = response.status;
        error.details = text;
        throw error;
      }

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const results: NormalizedImageResult[] = [];
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

      const collectFromParts = (partsInput: unknown[]) => {
        for (const part of partsInput) {
          if (!part || typeof part !== 'object') continue;
          const partRec = part as Record<string, unknown>;
          const inline =
            (partRec['inlineData'] as Record<string, unknown> | undefined) ??
            (partRec['inline_data'] as Record<string, unknown> | undefined);
          if (inline && typeof inline['data'] === 'string') {
            const mime =
              typeof inline['mimeType'] === 'string'
                ? inline['mimeType']
                : typeof inline['mime_type'] === 'string'
                  ? inline['mime_type']
                  : dto.mimeType || 'image/png';
            results.push({
              url: `data:${mime};base64,${inline['data']}`,
              mimeType: mime,
              provider: this.providerName,
              model: modelName,
            });
            continue;
          }

          const fileData =
            (partRec['fileData'] as Record<string, unknown> | undefined) ??
            (partRec['file_data'] as Record<string, unknown> | undefined);
          const uri =
            typeof fileData?.['fileUri'] === 'string'
              ? fileData['fileUri']
              : typeof fileData?.['file_uri'] === 'string'
                ? fileData['file_uri']
                : undefined;
          const mime =
            typeof fileData?.['mimeType'] === 'string'
              ? fileData['mimeType']
              : typeof fileData?.['mime_type'] === 'string'
                ? fileData['mime_type']
                : dto.mimeType || 'image/png';
          if (uri) {
            results.push({
              url: this.maybeAttachApiKey(uri, apiKey),
              mimeType: mime,
              provider: this.providerName,
              model: modelName,
            });
          }
        }
      };

      for (const candidate of candidates) {
        const content = candidate && typeof candidate === 'object'
          ? (candidate as Record<string, unknown>)['content']
          : undefined;
        const partsArray =
          (content && typeof content === 'object'
            ? (content as Record<string, unknown>)['parts']
            : undefined) ?? [];
        if (Array.isArray(partsArray)) {
          collectFromParts(partsArray);
        }
      }

      if (results.length === 0) {
        return { results, clientPayload: payload, rawResponse: payload };
      }

      return {
        results,
        clientPayload: { dataUrl: results[0].url, contentType: results[0].mimeType },
        rawResponse: payload,
      };
    };

    const tryPredictModel = async (modelName: string) => {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          accept: 'application/json',
        },
        body: JSON.stringify(buildPredictPayload()),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error: Error & { status?: number; details?: string } = new Error(
          `Gemini image API error ${response.status}`,
        );
        error.status = response.status;
        error.details = text;
        throw error;
      }

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const predictions = Array.isArray(payload.predictions) ? payload.predictions : [];
      const generatedImages = Array.isArray(payload.generatedImages) ? payload.generatedImages : [];
      const results: NormalizedImageResult[] = [];

      const collect = (source: unknown[]) => {
        for (const prediction of source) {
          const parsed = parsePrediction(prediction);
          if (parsed) {
            results.push({
              url: parsed.url,
              mimeType: parsed.mimeType,
              provider: this.providerName,
              model: modelName,
            });
          }
        }
      };

      collect(predictions);
      collect(generatedImages);

      if (results.length === 0) {
        return { results, clientPayload: payload, rawResponse: payload };
      }

      return {
        results,
        clientPayload: { dataUrl: results[0].url, contentType: results[0].mimeType },
        rawResponse: payload,
      };
    };

    let lastError: unknown;

    const runModel = async (modelName: string) => {
      // gemini-3-pro-image-preview should use generateContent endpoint (not predict)
      // This supports references and imageConfig properly
      const isGeminiContentModel =
        modelName.startsWith('gemini-') ||
        modelName.includes('gemini') ||
        modelName.includes('flash-image') ||
        modelName.includes('gemini-3.0-pro');

      const res = isGeminiContentModel
        ? await tryGenerateContent(modelName)
        : await tryPredictModel(modelName);

      return res;
    };

    for (const modelName of modelCandidates) {
      try {
        const res = await runModel(modelName);
        if (res.results && res.results.length > 0) {
          return res;
        }
        // if no results, try next candidate
        lastError = new Error(`Gemini model ${modelName} returned no results`);
        continue;
      } catch (error) {
        lastError = error;
        // Continue to next candidate on unsupported model errors
        const status = (error as { status?: number }).status;
        if (status !== 400 && status !== 404) {
          throw error;
        }
      }
    }

    if (lastError) {
      if (lastError instanceof Error) {
        throw lastError;
      }
      const errorMessage = typeof lastError === 'string' ? lastError : 'Unknown error occurred';
      throw new Error(errorMessage);
    }

    throw new Error('Gemini image generation failed for all model candidates');
  }
}
