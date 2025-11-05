import dns from 'node:dns/promises';
import net from 'node:net';

export interface SafeFetchOptions {
  /** Only allow HTTPS unless explicitly set true */
  allowHttp?: boolean;
  /** Allowed hostnames (exact match). If empty, no hosts are allowed. */
  allowedHosts: Set<string>;
  /** Optional allowed hostname suffixes (e.g., .googleapis.com) */
  allowedHostSuffixes?: Set<string>;
  /** Acceptable content-types (default: image/*) */
  acceptContentTypes?: RegExp;
  /** Maximum payload size in bytes (default: 15MB) */
  maxBytes?: number;
  /** Request timeout (ms) including DNS+TLS (default: 10000) */
  timeoutMs?: number;
  /** Maximum number of redirects to follow manually (default: 1) */
  maxRedirects?: number;
  /** Extra headers to send */
  headers?: Record<string, string>;
}

export interface SafeDownloadResult {
  arrayBuffer: ArrayBuffer;
  mimeType: string;
  bytes: number;
  finalUrl: string;
}

const DEFAULTS = {
  acceptContentTypes: /^image\//i,
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 1,
};

function isIpv6(address: string): boolean {
  return net.isIP(address) === 6;
}

function isPrivateIpv4(address: string): boolean {
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8
  const parts = address.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  // ::1/128 loopback, fe80::/10 link-local, fc00::/7 unique local
  const a = address.toLowerCase();
  if (a === '::1') return true;
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
  // fc00::/7 => fc00::/8 and fd00::/8
  if (a.startsWith('fc') || a.startsWith('fd')) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

function hostMatchesAllowlist(hostname: string, allowedHosts: Set<string>, allowedSuffixes?: Set<string>): boolean {
  if (allowedHosts.has(hostname)) return true;
  if (allowedSuffixes) {
    for (const suffix of allowedSuffixes) {
      if (hostname === suffix) return true;
      if (hostname.endsWith(suffix) && hostname[hostname.length - suffix.length - 1] === '.') return true;
    }
  }
  return false;
}

async function resolveAndAssertPublic(hostname: string): Promise<void> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: false });
    for (const r of records) {
      if (isPrivateAddress(r.address)) {
        throw new Error(`Blocked private address: ${r.address}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DNS resolution failed or blocked for ${hostname}: ${message}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  // Attach controller to fetch via options at call sites; here we just race abort.
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function fetchOnce(url: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, redirect: 'manual', signal: signal ?? controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function safeDownload(url: string, opts: SafeFetchOptions): Promise<SafeDownloadResult> {
  const {
    allowHttp = false,
    allowedHosts,
    allowedHostSuffixes,
    acceptContentTypes = DEFAULTS.acceptContentTypes,
    maxBytes = DEFAULTS.maxBytes,
    timeoutMs = DEFAULTS.timeoutMs,
    maxRedirects = DEFAULTS.maxRedirects,
    headers = {},
  } = opts;

  const visited = new Set<string>();
  let currentUrl = url;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const u = new URL(currentUrl);
    const isHttps = u.protocol === 'https:';
    if (!isHttps && !(allowHttp && u.protocol === 'http:')) {
      throw new Error(`Only HTTPS is allowed (got ${u.protocol})`);
    }

    if (!hostMatchesAllowlist(u.hostname, allowedHosts, allowedHostSuffixes)) {
      throw new Error(`Host not allowed: ${u.hostname}`);
    }

    await resolveAndAssertPublic(u.hostname);

    const response = await fetchOnce(u.toString(), headers, timeoutMs);

    // Handle manual redirects (3xx)
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) throw new Error(`Redirect (${response.status}) without Location header`);
      const nextUrl = new URL(loc, u).toString();
      if (visited.has(nextUrl)) throw new Error('Redirect loop detected');
      visited.add(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '<unavailable>');
      throw new Error(`Remote fetch failed ${response.status}: ${text.slice(0, 2000)}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!acceptContentTypes.test(contentType.split(';')[0] || '')) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const length = Number(contentLengthHeader);
      if (Number.isFinite(length) && length > maxBytes) {
        throw new Error(`Payload too large: ${length} > ${maxBytes}`);
      }
    }

    // Read into memory with a hard size cap
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    if (bytes > maxBytes) {
      throw new Error(`Payload too large after download: ${bytes} > ${maxBytes}`);
    }

    return {
      arrayBuffer,
      mimeType: contentType.split(';')[0] || 'application/octet-stream',
      bytes,
      finalUrl: u.toString(),
    };
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

export function toDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}


