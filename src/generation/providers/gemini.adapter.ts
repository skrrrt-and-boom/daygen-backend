import type { ImageProviderAdapter, ProviderAdapterResult, NormalizedImageResult } from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';

/**
 * Imagen image adapter using Google's Imagen API for reliable image generation.
 * Uses the dedicated Imagen models instead of Gemini's multimodal API to avoid NO_IMAGE errors.
 */
export class GeminiImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'gemini';

  constructor(private readonly getApiKey: () => string | undefined) { }

  canHandleModel(model: string): boolean {
    return (
      model === 'gemini-2.5-flash-image' ||
      model === 'gemini-2.5-flash-image-preview' ||
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

    // Map legacy model names to Imagen models, default to fast for speed
    const modelMap: Record<string, string> = {
      'gemini-2.5-flash-image': 'imagen-4.0-fast-generate-001',
      'gemini-2.5-flash-image-preview': 'imagen-4.0-fast-generate-001',
    };
    const requestedModel = dto.model?.trim() || 'gemini-2.5-flash-image';
    const targetModel = modelMap[requestedModel] || requestedModel || 'imagen-4.0-fast-generate-001';

    const prompt = (dto.prompt ?? '').toString().trim();
    if (!prompt) {
      throw new Error('Prompt is required for Imagen image generation');
    }

    // Build Imagen parameters from DTO
    const providerOptions = dto.providerOptions || {};
    const parameters: Record<string, unknown> = {
      sampleCount: 1, // Default to 1 image, can be 1-4
    };

    // Map aspectRatio from providerOptions or config
    const aspectRatio = providerOptions.aspectRatio as string | undefined;
    if (aspectRatio && typeof aspectRatio === 'string') {
      // Imagen supports: "1:1", "3:4", "4:3", "9:16", "16:9"
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
      if (targetModel.includes('ultra') || targetModel.includes('generate-001')) {
        parameters.imageSize = imageSize;
      }
    }

    // Map personGeneration if provided
    const personGeneration = providerOptions.personGeneration as string | undefined;
    if (personGeneration && typeof personGeneration === 'string') {
      const validOptions = ['dont_allow', 'allow_adult', 'allow_all'];
      if (validOptions.includes(personGeneration)) {
        parameters.personGeneration = personGeneration;
      }
    }

    // Build Imagen request payload
    const requestPayload: Record<string, unknown> = {
      instances: [
        {
          prompt: prompt,
        },
      ],
      parameters,
    };

    // Note: Imagen API doesn't support reference images in the same way as Gemini multimodal
    // Reference images would need to be handled differently if needed

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:predict?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Imagen API error ${response.status}`), {
        status: response.status,
        details: text,
      });
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const results: NormalizedImageResult[] = [];

    // Parse Imagen API response format: { predictions: [{ bytesBase64Encoded: string }] }
    const predictions = Array.isArray(payload.predictions)
      ? payload.predictions
      : [];

    for (const prediction of predictions) {
      if (prediction && typeof prediction === 'object') {
        const predictionObj = prediction as Record<string, unknown>;
        const bytesBase64Encoded = predictionObj.bytesBase64Encoded;
        if (typeof bytesBase64Encoded === 'string' && bytesBase64Encoded.trim()) {
          const mime = 'image/png'; // Imagen returns PNG format
          const url = `data:${mime};base64,${bytesBase64Encoded}`;
          results.push({
            url,
            mimeType: mime,
            provider: this.providerName,
            model: targetModel,
          });
        }
      }
    }

    if (results.length === 0) {
      // Fallback: surface the payload for upstream resolution
      return { results, clientPayload: payload, rawResponse: payload };
    }

    return {
      results,
      clientPayload: { dataUrl: results[0].url, contentType: results[0].mimeType },
      rawResponse: payload,
    };
  }
}


