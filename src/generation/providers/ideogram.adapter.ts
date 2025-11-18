import type {
  ImageProviderAdapter,
  ProviderAdapterResult,
  NormalizedImageResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import { IDEOGRAM_ALLOWED_HOSTS, COMMON_ALLOWED_SUFFIXES } from '../allowed-hosts';
import { safeDownload, toDataUrl } from '../safe-fetch';

export class IdeogramImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'ideogram';

  constructor(private readonly getApiKey: () => string | undefined) {}

  canHandleModel(model: string): boolean {
    return model === 'ideogram' || model === 'ideogram-v3';
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw Object.assign(new Error('IDEOGRAM_API_KEY not configured'), { status: 503 });

    const form = new FormData();
    form.set('prompt', dto.prompt);

    const addStr = (name: string, val?: unknown) => {
      if (typeof val === 'string' && val.trim()) form.set(name, val.trim());
    };
    const addNum = (name: string, val?: unknown) => {
      if (typeof val === 'number' && Number.isFinite(val)) form.set(name, String(val));
    };

    const opts: Record<string, unknown> = {};
    Object.assign(opts, dto.providerOptions ?? {});
    const aspect = (opts['aspect_ratio'] ?? opts['aspectRatio']) as string | undefined;
    if (aspect && aspect.trim()) {
      form.set('aspect_ratio', aspect.replace(':', 'x'));
    }
    addStr('resolution', opts['resolution']);
    addStr('rendering_speed', opts['rendering_speed'] ?? opts['renderingSpeed']);
    addStr('magic_prompt', opts['magic_prompt'] ?? opts['magicPrompt']);
    addStr('style_preset', opts['style_preset'] ?? opts['stylePreset']);
    addStr('style_type', opts['style_type'] ?? opts['styleType']);
    addStr('negative_prompt', opts['negative_prompt'] ?? opts['negativePrompt']);
    addNum('num_images', opts['num_images'] ?? opts['numImages']);
    addNum('seed', opts['seed']);

    const styleCodes = opts['style_codes'] ?? opts['styleCodes'];
    if (Array.isArray(styleCodes)) {
      for (const code of styleCodes) {
        if (typeof code === 'string' && code.trim()) form.append('style_codes', code.trim());
      }
    }

    const colorPalette = opts['color_palette'] ?? opts['colorPalette'];
    if (colorPalette !== undefined) {
      const serialized = typeof colorPalette === 'string' ? colorPalette : JSON.stringify(colorPalette);
      if (serialized.trim()) form.set('color_palette', serialized.trim());
    }

    if (!form.has('aspect_ratio')) form.set('aspect_ratio', '1x1');
    if (!form.has('rendering_speed')) form.set('rendering_speed', 'DEFAULT');
    if (!form.has('magic_prompt')) form.set('magic_prompt', 'AUTO');
    if (!form.has('num_images')) form.set('num_images', '1');

    // Handle reference image (first one only)
    if (dto.references && dto.references.length > 0) {
      const refUrl = dto.references[0];
      try {
        const dl = await safeDownload(refUrl, {
          allowedHosts: IDEOGRAM_ALLOWED_HOSTS,
          allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
        });
        const blob = new Blob([dl.arrayBuffer], { type: dl.mimeType });
        form.set('image_request', blob, 'reference_image');
      } catch (error) {
        throw Object.assign(new Error(`Failed to process reference image: ${error}`), { status: 400 });
      }
    }

    const response = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST',
      headers: { 'Api-Key': apiKey, Accept: 'application/json' },
      body: form,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const msg = this.extractMessage(payload) || `Ideogram API error: ${response.status}`;
      throw Object.assign(new Error(msg), { status: response.status, details: payload });
    }

    const urls = this.collectUrls(payload);
    if (urls.length === 0) throw Object.assign(new Error('No images returned from Ideogram'), { status: 400 });

    const results: NormalizedImageResult[] = [];
    for (const url of urls) {
      if (url.startsWith('data:')) {
        const m = url.match(/^data:([^;,]+);/);
        results.push({ url, mimeType: (m && m[1]) || 'image/png', provider: this.providerName, model: 'ideogram-v3' });
        continue;
      }
      const dl = await safeDownload(url, { allowedHosts: IDEOGRAM_ALLOWED_HOSTS, allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES });
      results.push({ url: toDataUrl(dl.arrayBuffer, dl.mimeType), mimeType: dl.mimeType, provider: this.providerName, model: 'ideogram-v3' });
    }

    return {
      results,
      clientPayload: { dataUrls: results.map((r) => r.url) },
      rawResponse: payload,
    };
  }

  private extractMessage(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const v = value as Record<string, unknown>;
    const direct = typeof v['message'] === 'string' ? v['message'] : undefined;
    if (direct) return direct;
    const err = v['error'];
    if (err && typeof err === 'object') {
      const errMsg = (err as { message?: unknown }).message;
      if (typeof errMsg === 'string') return errMsg;
    }
    return undefined;
  }

  private collectUrls(payload: Record<string, unknown>): string[] {
    const out: string[] = [];
    const pushIf = (val: unknown) => {
      if (typeof val === 'string' && val.trim()) out.push(val.trim());
    };
    const tryArray = (arr: unknown) => {
      if (!Array.isArray(arr)) return;
      for (const e of arr) {
        if (typeof e === 'string') pushIf(e);
        else if (e && typeof e === 'object') {
          const rec = e as Record<string, unknown>;
          pushIf(rec['url']);
          pushIf(rec['image']);
          pushIf(rec['image_url']);
        }
      }
    };

    tryArray(payload['images']);
    if (out.length > 0) return out;

    const data = payload['data'];
    tryArray(data);
    return out;
  }
}


