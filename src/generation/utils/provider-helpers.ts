import { HttpStatus } from '@nestjs/common';

export type JsonRecord = Record<string, unknown>;

export const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toJsonRecord = (value: unknown): JsonRecord =>
  isJsonRecord(value) ? value : {};

export const optionalJsonRecord = (
  value: unknown,
): JsonRecord | undefined => (isJsonRecord(value) ? value : undefined);

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const getFirstString = (
  source: JsonRecord,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const candidate = asString(source[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
};

export const getNestedString = (
  source: JsonRecord,
  path: readonly string[],
): string | undefined => {
  let current: unknown = source;
  for (const segment of path) {
    if (!isJsonRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return asString(current);
};

export const isProbablyBase64 = (value: string): boolean => {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 32) {
    return false;
  }
  if (trimmed.includes(':') && !trimmed.startsWith('data:')) {
    return false;
  }
  return /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
};

export const buildHttpErrorPayload = (
  rawMessage: string,
  details?: unknown,
) => {
  const message =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0
      ? rawMessage.trim()
      : 'Unexpected provider error';
  const payload: Record<string, unknown> = {
    message,
    error: message,
  };
  if (details !== undefined) {
    payload.details = details;
  }
  return payload;
};

export const stringifyUnknown = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

export const httpStatusFromError = (err: unknown, fallback = 502): number => {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number' && status >= 100 && status <= 599) {
    return status;
  }
  return fallback;
};

export interface ProviderHttpExceptionLike {
  status?: number;
  details?: unknown;
}

export const normalizeHttpException = (
  error: ProviderHttpExceptionLike | Error,
) => {
  const status = httpStatusFromError(error, HttpStatus.BAD_GATEWAY);
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Provider request failed';
  const details =
    typeof error === 'object' && error !== null && 'details' in error
      ? (error).details
      : undefined;
  return {
    status,
    message,
    payload: buildHttpErrorPayload(message, details),
  };
};

