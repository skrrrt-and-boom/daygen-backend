import type { SanitizedUser } from '../users/types';
import type { ProviderGenerateDto } from './dto/base-generate.dto';

export interface NormalizedImageResult {
  /** Final usable URL (prefer R2 URL if available; else provider URL) */
  url: string;
  /** MIME type of the image content */
  mimeType: string;
  /** Optional size in bytes if known */
  bytes?: number;
  /** Optional dimensions if known */
  width?: number;
  height?: number;
  /** R2 metadata if persisted */
  r2FileId?: string;
  r2FileUrl?: string;
  /** Provenance */
  provider?: string;
  model?: string;
  /** Arbitrary provider-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface ProviderAdapterResult {
  /** One or more images produced by the provider */
  results: NormalizedImageResult[];
  /** Backward-compatible payload expected by existing clients */
  clientPayload: unknown;
  /** Raw provider response for logging/diagnostics */
  rawResponse?: unknown;
  /** Optional usage/telemetry metadata returned by provider */
  usageMetadata?: Record<string, unknown>;
}

export interface ImageProviderAdapter {
  /** Short provider identifier, e.g., "gemini", "flux", "ideogram" */
  readonly providerName: string;
  /** Return true if this adapter supports the provided model id */
  canHandleModel(model: string): boolean;
  /**
   * Perform generation for a given user and DTO.
   * Implementations should NOT mutate the input DTO.
   */
  generate(user: SanitizedUser, dto: ProviderGenerateDto): Promise<ProviderAdapterResult>;
  /**
   * Validate provider-specific options in the DTO.
   * Should throw HttpException (usually BadRequest) if invalid.
   */
  validateOptions?(dto: ProviderGenerateDto): void;
}


