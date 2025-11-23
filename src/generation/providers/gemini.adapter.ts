import type { ImageProviderAdapter, ProviderAdapterResult, NormalizedImageResult } from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';

/**
 * Imagen image adapter using Google's Imagen API for reliable image generation.
 * Uses the dedicated Imagen models instead of Gemini's multimodal API to avoid NO_IMAGE errors.
 */
const stripDataUrlPrefix = (value: string): string => {
  if (!value) return value;
  const commaIndex = value.indexOf(',');
  if (value.startsWith('data:') && commaIndex !== -1) {
    return value.slice(commaIndex + 1);
  }
  return value;
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

  canHandleModel(model: string): boolean {
    return (
      model === 'gemini-3.0-pro-image' ||
      model === 'gemini-3.0-pro' ||
      model === 'gemini-3.0-pro-exp-01' ||
      model === 'gemini-3-pro-image-preview' ||
      model === 'gemini-3-pro-image' ||
      model === 'gemini-2.5-flash-image' ||
      model === 'imagen-4.0-generate-001' ||
      model === 'imagen-4.0-fast-generate-001' ||
      model === 'imagen-4.0-ultra-generate-001' ||
      model === 'imagen-3.0-generate-002'
    );
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
    const modelMap: Record<string, string> = {
      'gemini-3.0-pro-image': 'gemini-3-pro-image-preview',
      'gemini-3-pro-image': 'gemini-3-pro-image-preview',
      'gemini-3-pro': 'gemini-3-pro-image-preview',
      'gemini-3.0-pro': 'gemini-3-pro-image-preview',
      'gemini-3.0-pro-exp-01': 'gemini-3-pro-image-preview',
    };
    const requestedModel = dto.model?.trim() || 'gemini-3.0-pro-image';
    const primaryModel = modelMap[requestedModel] || requestedModel || 'gemini-3-pro-image-preview';
    const modelCandidates = Array.from(
      new Set([
        primaryModel,
        'gemini-2.5-flash-image',
        'imagen-4.0-fast-generate-001',
        'imagen-4.0-generate-001',
        'imagen-4.0-ultra-generate-001',
      ].filter(Boolean)),
    );

    const prompt = (dto.prompt ?? '').toString().trim();
    if (!prompt) {
      throw new Error('Prompt is required for Imagen image generation');
    }

    const references = Array.isArray(dto.references) && dto.references.length > 0
      ? dto.references
          .map((ref) => (typeof ref === 'string' ? ref.trim() : ''))
          .filter((ref) => Boolean(ref) && ref.length > 0)
          .slice(0, 3)
          .map((ref) => stripDataUrlPrefix(ref))
          .map((base64) => base64.trim())
          .filter((base64) => base64.length > 0)
      : undefined;

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
      const referenceImages = references
        ? references.map((base64) => ({
          image: {
            imageBytes: base64,
            mimeType: 'image/png',
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

      if (dto.imageBase64) {
        parts.push({
          inline_data: {
            mime_type: dto.mimeType || 'image/png',
            data: stripDataUrlPrefix(dto.imageBase64),
          },
        });
      }

      if (references) {
        for (const base64 of references) {
          parts.push({
            inline_data: {
              mime_type: 'image/png',
              data: base64,
            },
          });
        }
      }

      const generationConfig: Record<string, unknown> = {};
      if (dto.temperature !== undefined) generationConfig.temperature = dto.temperature;
      if (dto.topP !== undefined) generationConfig.top_p = dto.topP;
      if (dto.outputLength !== undefined) generationConfig.max_output_tokens = dto.outputLength;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          accept: 'application/json',
        },
        body: JSON.stringify(
          generationConfig && Object.keys(generationConfig).length > 0
            ? { contents: [{ role: 'user', parts }], generation_config: generationConfig }
            : { contents: [{ role: 'user', parts }] },
        ),
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
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${apiKey}`;
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
      const isGeminiContentModel =
        modelName.startsWith('gemini-') ||
        modelName.includes('gemini') ||
        modelName.includes('flash-image');

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
