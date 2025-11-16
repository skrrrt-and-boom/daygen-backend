/**
 * Centralized allowlists for remote asset downloads per provider.
 * These are conservative defaults and can be extended via configuration if needed.
 */

// FLUX (BFL)
export const FLUX_ALLOWED_POLL_HOSTS = new Set<string>([
  'api.bfl.ai',
  'api.eu.bfl.ai',
  'api.us.bfl.ai',
  'api.eu1.bfl.ai',
  'api.us1.bfl.ai',
  'api.eu2.bfl.ai',
  'api.us2.bfl.ai',
  'api.eu3.bfl.ai',
  'api.us3.bfl.ai',
  'api.eu4.bfl.ai',
  'api.us4.bfl.ai',
]);

export const FLUX_ALLOWED_DOWNLOAD_HOSTS = new Set<string>([
  'delivery.bfl.ai',
  'cdn.bfl.ai',
  'storage.googleapis.com',
]);

// Ideogram: CDN and API may return image URLs under ideogram domains or Google Cloud Storage
export const IDEOGRAM_ALLOWED_HOSTS = new Set<string>([
  'api.ideogram.ai',
  'ideogram.ai',
  'cdn.ideogram.ai',
  'storage.googleapis.com',
]);

// Runway: API + potential CDN/backends
export const RUNWAY_ALLOWED_HOSTS = new Set<string>([
  'api.dev.runwayml.com',
  'runwayml.com',
  'cdn.runwayml.com',
  'storage.googleapis.com',
  'cloudfront.net',
]);

// Qwen (DashScope)
export const QWEN_ALLOWED_HOSTS = new Set<string>([
  'dashscope-intl.aliyuncs.com',
  'dashscope.aliyuncs.com',
  'dashscope.alibabacloud.com',
  'oss-cn-hangzhou.aliyuncs.com',
  'oss-accelerate.aliyuncs.com',
]);

// Recraft
export const RECRAFT_ALLOWED_HOSTS = new Set<string>([
  'api.recraft.ai',
  'recraft.ai',
  'cdn.recraft.ai',
  'storage.googleapis.com',
]);

// Luma
export const LUMA_ALLOWED_HOSTS = new Set<string>([
  'api.lumalabs.ai',
  'lumalabs.ai',
  'cdn.lumalabs.ai',
  'storage.googleapis.com',
]);

// Reve (placeholder domain list; refine when confirmed)
export const REVE_ALLOWED_HOSTS = new Set<string>([
  'api.reve.ai',
  'reve.ai',
  'cdn.reve.ai',
  'storage.googleapis.com',
]);

// Grok (xAI)
export const GROK_ALLOWED_HOSTS = new Set<string>([
  'data.x.ai',
  'cdn.x.ai',
  'storage.googleapis.com',
]);

export const GROK_ALLOWED_SUFFIXES = new Set<string>(['.x.ai']);

// Seedream / Ark Labs
export const SEEDREAM_ALLOWED_HOSTS = new Set<string>([
  'ark.ap-southeast.bytepluses.com',
  'bytepluses.com',
  'storage.googleapis.com',
]);

// Common public suffixes often used by providers/CDNs — used as a softer allowlist supplement
export const COMMON_ALLOWED_SUFFIXES = new Set<string>([
  '.googleusercontent.com',
  '.storage.googleapis.com',
  '.s3.amazonaws.com',
  '.amazonaws.com',
  '.cloudfront.net',
]);

