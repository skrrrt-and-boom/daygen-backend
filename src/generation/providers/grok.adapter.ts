import type {
  ImageProviderAdapter,
  ProviderAdapterResult,
  NormalizedImageResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import {
  COMMON_ALLOWED_SUFFIXES,
  GROK_ALLOWED_HOSTS,
  GROK_ALLOWED_SUFFIXES,
} from '../allowed-hosts';
import { safeDownload, toDataUrl } from '../safe-fetch';

type ResponseFormat = 'url' | 'b64_json';

const SUPPORTED_MODELS = new Set([
  'grok-2-image',
  'grok-2-image-1212',
  'grok-2-image-latest',
]);

const DEFAULT_MODEL = 'grok-2-image';
const DEFAULT_MIME_TYPE = 'image/jpeg';

const DEFAULT_RESPONSE_FORMAT: ResponseFormat = 'b64_json';
const DEFAULT_FETCH_TIMEOUT_MS = 30_000; // 30 seconds

const mergedSuffixes = (() => {
  const suffixes = new Set<string>();
  GROK_ALLOWED_SUFFIXES.forEach((suffix) => suffixes.add(suffix));
  COMMON_ALLOWED_SUFFIXES.forEach((suffix) => suffixes.add(suffix));
  return suffixes;
})();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const normalizeResponseFormat = (value: unknown): ResponseFormat => {
  const candidate =
    typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  if (!candidate) {
    return DEFAULT_RESPONSE_FORMAT;
  }

  if (candidate === 'url' || candidate === 'urls') {
    return 'url';
  }

  if (
    candidate === 'b64_json' ||
    candidate === 'b64-json' ||
    candidate === 'base64' ||
    candidate === 'base64_json' ||
    candidate === 'base64-json'
  ) {
    return 'b64_json';
  }

  return DEFAULT_RESPONSE_FORMAT;
};

const toCount = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(10, Math.max(1, Math.trunc(value)));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return Math.min(10, Math.max(1, parsed));
    }
  }
  return undefined;
};

const stripDataUrlPrefix = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:[^;,]+;base64,(.*)$/);
    return match ? match[1] ?? '' : trimmed;
  }
  return trimmed;
};

export class GrokImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'grok';

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly getApiBase?: () => string | undefined,
  ) {}

  canHandleModel(model: string): boolean {
    return SUPPORTED_MODELS.has(model);
  }

  private resolveModel(model?: string): string {
    if (model && SUPPORTED_MODELS.has(model)) {
      return model;
    }
    return DEFAULT_MODEL;
  }

  private buildProviderOptions(dto: ProviderGenerateDto) {
    const options = dto.providerOptions ?? {};
    const responseFormat = normalizeResponseFormat(
      options['response_format'] ??
        options['responseFormat'] ??
        options['image_format'] ??
        options['imageFormat'],
    );
    const n = toCount(options['n'] ?? options['count']);
    return { responseFormat, count: n };
  }

  async generate(
    _user: SanitizedUser,
    dto: ProviderGenerateDto,
  ): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw Object.assign(new Error('XAI_API_KEY is not configured'), {
        status: 503,
      });
    }

    const apiBase = (this.getApiBase?.() ?? 'https://api.x.ai').replace(/\/$/, '');
    const endpoint = `${apiBase}/v1/images/generations`;
    const resolvedModel = this.resolveModel(dto.model);
    const { responseFormat, count } = this.buildProviderOptions(dto);

    const body: Record<string, unknown> = {
      prompt: dto.prompt,
      model: resolvedModel,
      response_format: responseFormat,
    };

    if (typeof count === 'number') {
      body.n = count;
    }

    // Set up timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);

    let response: Response;
    let payload: unknown;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      payload = (await response
        .json()
        .catch(async () => ({
          raw: await response.text().catch(() => '<unavailable>'),
        }))) as unknown;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle different types of errors
      if (error instanceof Error) {
        // Check for timeout/abort
        if (error.name === 'AbortError' || controller.signal.aborted) {
          throw Object.assign(
            new Error('xAI image API request timed out'),
            { status: 504 },
          );
        }

        // Check for SSL/TLS errors
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('certificate') ||
          errorMessage.includes('ssl') ||
          errorMessage.includes('tls') ||
          errorMessage.includes('cert')
        ) {
          throw Object.assign(
            new Error(`xAI image API SSL/TLS error: ${error.message}`),
            { status: 502 },
          );
        }

        // Check for network errors
        if (
          errorMessage.includes('network') ||
          errorMessage.includes('fetch') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('econnrefused') ||
          errorMessage.includes('enotfound')
        ) {
          throw Object.assign(
            new Error(`xAI image API network error: ${error.message}`),
            { status: 503 },
          );
        }

        // Generic error
        throw Object.assign(
          new Error(`xAI image API request failed: ${error.message}`),
          { status: 502 },
        );
      }

      // Unknown error type
      throw Object.assign(
        new Error('xAI image API request failed with unknown error'),
        { status: 502 },
      );
    }

    if (!response.ok) {
      const record = asRecord(payload);
      const errorRecord = record && asRecord(record['error']);
      const message =
        asString(errorRecord?.['message']) ??
        asString(record?.['message']) ??
        `xAI image API error ${response.status}`;
      throw Object.assign(new Error(message), {
        status: response.status,
        details: payload,
      });
    }

    const payloadRecord = asRecord(payload);
    const dataEntries = Array.isArray(payloadRecord?.['data'])
      ? (payloadRecord?.['data'] as unknown[])
      : [];

    if (dataEntries.length === 0) {
      throw Object.assign(
        new Error('xAI image API returned no images'),
        {
          status: 502,
          details: payload,
        },
      );
    }

    const results: NormalizedImageResult[] = [];
    for (let index = 0; index < dataEntries.length; index += 1) {
      const entry = asRecord(dataEntries[index]);
      if (!entry) {
        continue;
      }

      const revisedPrompt = asString(entry['revised_prompt']);
      const mimeType = asString(entry['mimeType']) ?? DEFAULT_MIME_TYPE;
      const inline = asString(entry['b64_json']);
      const remote = asString(entry['url']);

      let dataUrl: string | null = null;

      if (inline) {
        if (inline.startsWith('data:')) {
          dataUrl = inline;
        } else {
          const base64 = stripDataUrlPrefix(inline);
          dataUrl = `data:${mimeType};base64,${base64}`;
        }
      } else if (remote) {
        const download = await safeDownload(remote, {
          allowedHosts: GROK_ALLOWED_HOSTS,
          allowedHostSuffixes: mergedSuffixes,
        }).catch((error: unknown) => {
          throw Object.assign(
            new Error(
              error instanceof Error ? error.message : 'Failed to download Grok image',
            ),
            { status: 502 },
          );
        });
        dataUrl = toDataUrl(download.arrayBuffer, download.mimeType || mimeType);
      }

      if (!dataUrl) {
        continue;
      }

      results.push({
        url: dataUrl,
        mimeType,
        provider: this.providerName,
        model: resolvedModel,
        metadata: revisedPrompt
          ? {
              revisedPrompt,
              index,
            }
          : { index },
      });
    }

    if (results.length === 0) {
      throw Object.assign(
        new Error('xAI image API returned data but no usable images'),
        { status: 502, details: payload },
      );
    }

    const first = results[0];
    const revisedPrompts = results
      .map((res) => asString(res.metadata?.['revisedPrompt']))
      .filter((value): value is string => Boolean(value));

    return {
      results,
      clientPayload: {
        dataUrl: first.url,
        dataUrls: results.map((res) => res.url),
        contentType: first.mimeType,
        revisedPrompts,
      },
      rawResponse: payload,
      usageMetadata: {
        model: resolvedModel,
        responseFormat,
        count: results.length,
      },
    };
  }
}

