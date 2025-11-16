import type {
  ImageProviderAdapter,
  ProviderAdapterResult,
  NormalizedImageResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import {
  FLUX_ALLOWED_POLL_HOSTS,
  FLUX_ALLOWED_DOWNLOAD_HOSTS,
  COMMON_ALLOWED_SUFFIXES,
} from '../allowed-hosts';
import { safeDownload, toDataUrl } from '../safe-fetch';

const FLUX_OPTION_KEYS = [
  'width',
  'height',
  'aspect_ratio',
  'raw',
  'image_prompt',
  'image_prompt_strength',
  'input_image',
  'input_image_2',
  'input_image_3',
  'input_image_4',
  'seed',
  'output_format',
  'prompt_upsampling',
  'safety_tolerance',
] as const;

const FLUX_POLL_INTERVAL_MS = 5000;
const FLUX_MAX_ATTEMPTS = 60; // ~5 min

export class FluxImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'flux';

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly getApiBase: () => string | undefined,
  ) {}

  canHandleModel(model: string): boolean {
    return model.startsWith('flux-');
  }

  async generate(_user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw Object.assign(new Error('BFL_API_KEY is not configured'), { status: 503 });

    const apiBase = (this.getApiBase() ?? 'https://api.bfl.ai').replace(/\/$/, '');
    const model = (dto.model || 'flux-pro-1.1').trim();
    const endpoint = `${apiBase}/v1/${model}`;

    const providerOptions = dto.providerOptions ?? {};
    const optionsRecord: Record<string, unknown> = {};
    Object.assign(optionsRecord, providerOptions);
    const payload: Record<string, unknown> = { prompt: dto.prompt };
    for (const key of FLUX_OPTION_KEYS) {
      const value = optionsRecord[key];
      if (value !== undefined && value !== null) payload[key] = value;
    }
    if (Array.isArray(dto.references) && dto.references.length > 0) {
      payload.references = dto.references;
    }

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-key': apiKey, accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    const createPayload = (await createResponse
      .json()
      .catch(async () => ({ raw: await createResponse.text().catch(() => '<unavailable>') }))) as unknown;
    if (createResponse.status === 402) {
      throw Object.assign(new Error('BFL credits exceeded (402). Add credits to proceed.'), { status: 402 });
    }
    if (createResponse.status === 429) {
      throw Object.assign(new Error('BFL rate limit: too many active tasks (429). Try later.'), { status: 429 });
    }
    if (!createResponse.ok) {
      throw Object.assign(new Error(`BFL error ${createResponse.status}`), {
        status: createResponse.status,
        details: createPayload,
      });
    }

    const createRecord = (createPayload ?? {}) as Record<string, unknown>;
    const jobId = this.firstString(createRecord, ['id', 'job_id', 'task_id', 'jobId']);
    const pollingUrl = this.firstString(createRecord, ['polling_url', 'pollingUrl', 'polling_url_v2']);
    if (!pollingUrl) {
      throw Object.assign(new Error('BFL response missing polling URL'), { status: 502 });
    }
    this.assertAllowedHost(pollingUrl, FLUX_ALLOWED_POLL_HOSTS, 'poll');

    const pollResult = await this.poll(pollingUrl, apiKey);
    const sampleUrl = this.extractSampleUrl(pollResult.payload);
    if (!sampleUrl) throw Object.assign(new Error('Flux response did not include an image URL'), { status: 502 });

    if (!sampleUrl.startsWith('data:')) {
      this.assertAllowedHost(sampleUrl, FLUX_ALLOWED_DOWNLOAD_HOSTS, 'download');
    }

    // Download and return data URL
    let dataUrl: string;
    let mimeType = 'image/png';
    if (sampleUrl.startsWith('data:')) {
      dataUrl = sampleUrl;
      const m = sampleUrl.match(/^data:([^;,]+);/);
      if (m) mimeType = m[1];
    } else {
      const dl = await safeDownload(sampleUrl, {
        allowedHosts: FLUX_ALLOWED_DOWNLOAD_HOSTS,
        allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
      });
      dataUrl = toDataUrl(dl.arrayBuffer, dl.mimeType);
      mimeType = dl.mimeType;
    }

    const result: NormalizedImageResult = {
      url: dataUrl,
      mimeType,
      provider: this.providerName,
      model,
      metadata: { jobId, status: pollResult.status },
    };

    return {
      results: [result],
      clientPayload: {
        dataUrl,
        contentType: mimeType,
        jobId: jobId ?? null,
        status: pollResult.status,
      },
      rawResponse: { create: createPayload, final: pollResult.raw },
      usageMetadata: { jobId: jobId ?? null, pollingUrl, status: pollResult.status },
    };
  }

  private async poll(pollingUrl: string, apiKey: string): Promise<{ payload: Record<string, unknown>; raw: unknown; status: string }> {
    let last: unknown = null;
    for (let attempt = 0; attempt < FLUX_MAX_ATTEMPTS; attempt += 1) {
      const res = await fetch(pollingUrl, { headers: { 'x-key': apiKey, accept: 'application/json' } });
      const text = await res.text().catch(() => '');
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = { raw: text } as unknown;
        }
      }
      if (!res.ok) {
        throw Object.assign(new Error('Flux polling failed'), { status: res.status, details: payload });
      }
      last = payload;
      const record = (payload ?? {}) as Record<string, unknown>;
      const statusValue =
        this.firstString(record, ['status', 'task_status', 'state']) ||
        (typeof record.result === 'object' && record.result !== null
          ? this.firstString(record.result as Record<string, unknown>, ['status'])
          : undefined);
      const status = this.normalizeStatus(statusValue);
      if (status === 'READY') return { payload: record, raw: payload, status };
      if (status === 'FAILED' || status === 'ERROR') {
        const details = (record as any).error ?? (record as any).details ?? payload;
        throw Object.assign(new Error('Flux generation failed'), { status: 502, details });
      }
      await new Promise((r) => setTimeout(r, FLUX_POLL_INTERVAL_MS));
    }
    throw Object.assign(new Error('Flux generation timed out'), { status: 408, details: last });
  }

  private extractSampleUrl(result: Record<string, unknown>): string | null {
    const get = (obj: Record<string, unknown>, k: string) => {
      const v = obj[k];
      return typeof v === 'string' ? v : null;
    };
    const nested = (obj: Record<string, unknown>, path: string[]): string | null => {
      let cur: any = obj;
      for (const p of path) {
        if (!cur || typeof cur !== 'object') return null;
        cur = cur[p];
      }
      return typeof cur === 'string' ? cur : null;
    };
    const direct = get(result, 'sample') || get(result, 'image');
    if (direct) return direct;
    const resRec = (result.result && typeof result.result === 'object') ? (result.result as Record<string, unknown>) : undefined;
    if (resRec) {
      const nestedUrl = nested(resRec, ['sample', 'url']);
      if (nestedUrl) return nestedUrl;
      const samples = Array.isArray((resRec as any).samples) ? (resRec as any).samples : [];
      for (const s of samples) {
        if (typeof s === 'string') return s;
        if (s && typeof s === 'object') {
          const c = this.firstString(s as Record<string, unknown>, ['url', 'image', 'sample']) || nested(s as Record<string, unknown>, ['asset', 'url']);
          if (c) return c;
        }
      }
      const images = Array.isArray((resRec as any).images) ? (resRec as any).images : [];
      for (const e of images) {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object') {
          const c = this.firstString(e as Record<string, unknown>, ['url', 'image']);
          if (c) return c;
        }
      }
    }
    const imagesTop = Array.isArray((result as any).images) ? (result as any).images : [];
    for (const e of imagesTop) {
      if (typeof e === 'string') return e;
      if (e && typeof e === 'object') {
        const c = this.firstString(e as Record<string, unknown>, ['url', 'image']);
        if (c) return c;
      }
    }
    return null;
  }

  private normalizeStatus(value: unknown): 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'ERROR' {
    const raw =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
    const normalized = raw.trim().toUpperCase();
    if (['READY', 'COMPLETED', 'FINISHED', 'DONE'].includes(normalized)) return 'READY';
    if (['FAILED', 'FAILURE'].includes(normalized)) return 'FAILED';
    if (normalized === 'ERROR') return 'ERROR';
    if (['QUEUED', 'PENDING', 'QUEUING'].includes(normalized)) return 'QUEUED';
    return 'PROCESSING';
  }

  private firstString(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return null;
  }

  private assertAllowedHost(rawUrl: string, allowed: Set<string>, kind: string) {
    const u = new URL(rawUrl);
    const host = u.hostname;
    if (allowed.has(host)) return;
    for (const suffix of COMMON_ALLOWED_SUFFIXES) {
      if (host === suffix) return;
      if (host.endsWith(suffix) && host[host.length - suffix.length - 1] === '.') return;
    }
    throw Object.assign(new Error(`Flux ${kind} host not allowed: ${host}`), { status: 400 });
  }
}


