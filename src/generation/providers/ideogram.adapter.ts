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

  constructor(private readonly getApiKey: () => string | undefined) { }

  canHandleModel(model: string): boolean {
    return model === 'ideogram' || model === 'ideogram-v3';
  }

  validateOptions(dto: ProviderGenerateDto): void {
    const badRequest = (msg: string) =>
      Object.assign(new Error(msg), { status: 400 });
    const opts = dto.providerOptions ?? {};

    const num =
      typeof opts['num_images'] === 'number'
        ? opts['num_images']
        : opts['numImages'];
    if (typeof num === 'number') {
      if (!Number.isInteger(num) || num < 1 || num > 4) {
        throw badRequest('num_images must be an integer between 1 and 4');
      }
    }
    const arRaw = opts['aspect_ratio'] ?? opts['aspectRatio'];
    if (typeof arRaw === 'string' && arRaw.trim()) {
      const ar = arRaw.trim();
      if (!/^\d{1,4}[:x]\d{1,4}$/i.test(ar)) {
        throw badRequest('aspect_ratio must be like 1:1, 16:9, or 16x9');
      }
    }
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw Object.assign(new Error('IDEOGRAM_API_KEY not configured'), { status: 503 });

    const form = new FormData();
    const opts: Record<string, unknown> = {};
    Object.assign(opts, dto.providerOptions ?? {});

    // Check if this is an edit request (has mask)
    const maskDataUrl = opts['mask'] as string | undefined;
    const isEdit = !!maskDataUrl;

    // Determine endpoint
    const endpoint = isEdit
      ? 'https://api.ideogram.ai/v1/ideogram-v3/edit'
      : 'https://api.ideogram.ai/v1/ideogram-v3/generate';

    form.set('prompt', dto.prompt);

    const addStr = (name: string, val?: unknown) => {
      if (typeof val === 'string' && val.trim()) form.set(name, val.trim());
    };
    const addNum = (name: string, val?: unknown) => {
      if (typeof val === 'number' && Number.isFinite(val)) form.set(name, String(val));
    };

    const aspect = (opts['aspect_ratio'] ?? opts['aspectRatio']) as string | undefined;
    if (aspect && aspect.trim()) {
      form.set('aspect_ratio', aspect.replace(':', 'x'));
    }

    // Common parameters
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

    // Defaults
    if (!form.has('aspect_ratio') && !isEdit) form.set('aspect_ratio', '1x1');
    if (!form.has('rendering_speed')) form.set('rendering_speed', 'DEFAULT');
    if (!form.has('magic_prompt')) form.set('magic_prompt', 'AUTO');
    if (!form.has('num_images')) form.set('num_images', '1');

    // Handle Image and Mask for Edit
    if (isEdit) {
      if (dto.references && dto.references.length > 0) {
        const refUrl = dto.references[0];
        try {
          let buffer: Buffer;
          if (refUrl.startsWith('data:')) {
            const matches = refUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) throw new Error('Invalid data URL');
            buffer = Buffer.from(matches[2], 'base64');
          } else {
            const dl = await safeDownload(refUrl, {
              allowedHosts: IDEOGRAM_ALLOWED_HOSTS,
              allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
            });
            buffer = Buffer.from(dl.arrayBuffer);
          }

          // Detect MIME type from magic bytes
          const detection = this.detectMimeType(buffer);
          if (!detection) {
            throw Object.assign(new Error('Input image is not a supported format (PNG, JPEG, WEBP) or is corrupted.'), { status: 400 });
          }
          const { mimeType: mime, extension: ext } = detection;

          console.log(`[Ideogram] Input image detected as ${mime}, using extension: ${ext}`);
          const blob = new Blob([new Uint8Array(buffer)], { type: mime });
          form.set('image', blob, `image.${ext}`);
        } catch (error) {
          throw Object.assign(new Error(`Failed to process input image: ${error}`), { status: 400 });
        }
      } else {
        throw Object.assign(new Error('Image is required for editing'), { status: 400 });
      }

      // Process Mask
      try {
        // maskDataUrl is a data URL
        // We need to fetch it to get a blob. Since it's a data URL, fetch works.
        // However, in Node environment, fetch(dataUrl) might not work depending on version/polyfill.
        // But 'undici' (used in package.json) or native fetch in Node 18+ supports it.
        // Alternatively, we can parse the data URL manually.
        // Let's try manual parsing to be safe and avoid external fetch for local data.
        const matches = maskDataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          const blob = new Blob([buffer], { type: matches[1] });
          form.set('mask', blob, 'mask.png');
        } else {
          throw new Error('Invalid mask data URL');
        }
      } catch (error) {
        throw Object.assign(new Error(`Failed to process mask image: ${error}`), { status: 400 });
      }

    } else {
      // Normal Generate Flow (Remix / Image-to-Image)
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
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, Accept: 'application/json' },
      body: form,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const msg = this.extractMessage(payload) || `Ideogram API error: ${response.status}`;
      const detailedMsg = `${msg} - Details: ${JSON.stringify(payload)}`;
      console.error(`[Ideogram] API Error: ${detailedMsg}`);
      throw Object.assign(new Error(detailedMsg), { status: response.status, details: payload });
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

  private detectMimeType(buffer: Buffer): { mimeType: string, extension: string } | null {
    if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { mimeType: 'image/png', extension: 'png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', extension: 'webp' };
    }

    // Check for HTML/XML
    const head = buffer.subarray(0, 50).toString('utf8').trim().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')) {
      console.error(`[Ideogram] Input appears to be HTML/XML: ${head.substring(0, 100)}`);
      return null; // Will be handled by caller
    }

    console.warn(`[Ideogram] Could not detect magic bytes for input image. Header: ${buffer.subarray(0, 8).toString('hex')}`);
    return null;
  }
}


