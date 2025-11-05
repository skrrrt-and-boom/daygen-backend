import type { ImageProviderAdapter, ProviderAdapterResult, NormalizedImageResult } from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';

/**
 * Minimal Gemini image adapter using generateContent IMAGE modality.
 * Note: This adapter returns inline data results when available.
 * Remote file URIs are returned in metadata; upstream may resolve/stream to R2.
 */
export class GeminiImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'gemini';

  constructor(private readonly getApiKey: () => string | undefined) {}

  canHandleModel(model: string): boolean {
    return model === 'gemini-2.5-flash-image' || model === 'gemini-2.5-flash-image-preview';
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const targetModel = 'gemini-2.5-flash-image';

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    const prompt = (dto.prompt ?? '').toString();
    if (prompt.trim()) {
      parts.push({ text: prompt });
    }

    const pushInline = (data?: string | null, mime = 'image/png') => {
      if (!data || typeof data !== 'string') return;
      const trimmed = data.trim();
      if (!trimmed) return;
      const m = trimmed.match(/^data:([^;,]+);base64,(.*)$/);
      if (m) {
        parts.push({ inlineData: { mimeType: m[1] || mime, data: m[2].replace(/\s+/g, '') } });
      } else {
        parts.push({ inlineData: { mimeType: mime, data: trimmed.replace(/\s+/g, '') } });
      }
    };

    pushInline(dto.imageBase64, dto.mimeType || 'image/png');
    if (Array.isArray(dto.references)) {
      for (const ref of dto.references) pushInline(ref);
    }

    const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] };
    if (dto.temperature !== undefined) generationConfig.temperature = dto.temperature;
    if (dto.topP !== undefined) generationConfig.topP = dto.topP;
    if (dto.outputLength !== undefined) generationConfig.maxOutputTokens = dto.outputLength;

    const requestPayload: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Gemini error ${response.status}`), { status: response.status, details: text });
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const results: NormalizedImageResult[] = [];

    const candidates = Array.isArray((payload as any).candidates) ? (payload as any).candidates : [];
    const first = candidates[0] && typeof candidates[0] === 'object' ? candidates[0] : undefined;
    const content = first && typeof first.content === 'object' ? first.content : undefined;
    const partsOut: any[] = content && Array.isArray((content as any).parts) ? (content as any).parts : [];

    for (const p of partsOut) {
      if (p && typeof p === 'object' && p.inlineData && typeof p.inlineData.data === 'string') {
        const mime = typeof p.inlineData.mimeType === 'string' ? p.inlineData.mimeType : 'image/png';
        const url = `data:${mime};base64,${p.inlineData.data}`;
        results.push({ url, mimeType: mime, provider: this.providerName, model: targetModel });
        break;
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


