import type {
  ImageProviderAdapter,
  ProviderAdapterResult,
  NormalizedImageResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import { QWEN_ALLOWED_HOSTS, COMMON_ALLOWED_SUFFIXES } from '../allowed-hosts';
import { safeDownload, toDataUrl } from '../safe-fetch';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractDashscopeImageUrl(result: unknown): string | null {
  const resultRecord = asRecord(result);
  if (!resultRecord) return null;
  const outputRecord = asRecord(resultRecord['output']);
  if (!outputRecord) return null;
  for (const choice of asArray(outputRecord['choices'])) {
    const choiceRecord = asRecord(choice);
    if (!choiceRecord) continue;
    const messageRecord = asRecord(choiceRecord['message']);
    if (!messageRecord) continue;
    for (const item of asArray(messageRecord['content'])) {
      const itemRecord = asRecord(item);
      const image = itemRecord ? asString(itemRecord['image']) : undefined;
      if (image) return image;
    }
  }
  return null;
}

export class QwenImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'qwen';

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly getApiBase?: () => string | undefined,
  ) {}

  canHandleModel(model: string): boolean {
    return model === 'qwen-image';
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw Object.assign(new Error('DASHSCOPE_API_KEY is not configured'), { status: 503 });
    }
    const apiBase = (this.getApiBase?.() ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
    const endpoint = `${apiBase}/services/aigc/multimodal-generation/generation`;

    const parameters: Record<string, unknown> = {};
    const raw = dto.providerOptions ?? {};
    if (raw && typeof raw === 'object') {
      const size = (raw as Record<string, unknown>)['size'];
      if (typeof size === 'string' && size.trim()) parameters.size = size.trim();
      const seed = (raw as Record<string, unknown>)['seed'];
      if (typeof seed === 'number' && Number.isFinite(seed)) parameters.seed = seed;
      const negative = (raw as Record<string, unknown>)['negative_prompt'];
      if (typeof negative === 'string' && negative.trim()) parameters.negative_prompt = negative.trim();
      const promptExtend = (raw as Record<string, unknown>)['prompt_extend'];
      if (typeof promptExtend === 'boolean') parameters.prompt_extend = promptExtend;
      const watermark = (raw as Record<string, unknown>)['watermark'];
      if (typeof watermark === 'boolean') parameters.watermark = watermark;
    }

    const body = {
      model: 'qwen-image',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: dto.prompt }],
          },
        ],
      },
      parameters,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }))) as unknown;
    if (!response.ok) {
      const rec = asRecord(payload);
      const message =
        (rec && asString(rec['message'])) ||
        (rec && asRecord(rec['error']) && asString((rec['error'] as Record<string, unknown>)['message'])) ||
        `DashScope error ${response.status}`;
      throw Object.assign(new Error(message || `DashScope error ${response.status}`), { status: response.status, details: payload });
    }

    const imageUrl = extractDashscopeImageUrl(payload);
    if (!imageUrl) {
      throw Object.assign(new Error('No image returned from DashScope'), { status: 400, details: payload });
    }

    let dataUrl: string;
    let mimeType = 'image/png';
    if (imageUrl.startsWith('data:')) {
      dataUrl = imageUrl;
      const m = imageUrl.match(/^data:([^;,]+);/);
      if (m) mimeType = m[1];
    } else {
      const dl = await safeDownload(imageUrl, {
        allowedHosts: QWEN_ALLOWED_HOSTS,
        allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
      });
      dataUrl = toDataUrl(dl.arrayBuffer, dl.mimeType);
      mimeType = dl.mimeType;
    }

    const result: NormalizedImageResult = {
      url: dataUrl,
      mimeType,
      provider: this.providerName,
      model: 'qwen-image',
    };

    const usage = asRecord(asRecord(payload)?.['usage']) ?? undefined;

    return {
      results: [result],
      clientPayload: { dataUrl, contentType: mimeType, usage },
      rawResponse: payload,
    };
  }
}


