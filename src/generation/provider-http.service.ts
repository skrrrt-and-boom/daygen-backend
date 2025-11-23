import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isJsonRecord } from './utils/provider-helpers';

@Injectable()
export class ProviderHttpService {
  constructor(private readonly configService: ConfigService) { }

  async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<Response> {
    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }

    const defaultTimeout = this.configService.get<number>(
      'HTTP_TIMEOUT_MS',
      30000,
    );
    const finalTimeout = timeoutMs ?? defaultTimeout;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, finalTimeout),
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async safeJson(response: globalThis.Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    const isJson =
      contentType.includes('application/json') || contentType.endsWith('+json');
    try {
      if (isJson) {
        return await response.json();
      }
      const text = await response.text();
      if (!text) {
        return {};
      }
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    } catch {
      return {};
    }
  }

  extractProviderMessage(value: unknown): string | undefined {
    return this.extractProviderMessageInternal(value, new WeakSet<object>());
  }

  async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async sleep(ms: number): Promise<void> {
    await this.wait(ms);
  }

  private extractProviderMessageInternal(
    value: unknown,
    seen: WeakSet<object>,
  ): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const result = this.extractProviderMessageInternal(entry, seen);
        if (result) {
          return result;
        }
      }
      return undefined;
    }
    if (!isJsonRecord(value)) {
      return undefined;
    }
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);

    const candidateKeys = [
      'message',
      'error',
      'detail',
      'error_message',
      'failure',
      'title',
      'description',
      'reason',
    ] as const;

    for (const key of candidateKeys) {
      const result = this.extractProviderMessageInternal(value[key], seen);
      if (result) {
        return result;
      }
    }

    return undefined;
  }
}
