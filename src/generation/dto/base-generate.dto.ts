import {
  Allow,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const KNOWN_KEYS = new Set([
  'prompt',
  'model',
  'imageBase64',
  'mimeType',
  'references',
  'temperature',
  'outputLength',
  'topP',
  'providerOptions',
]);

function collectProviderOptions(obj: unknown) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {};
  }

  const source = obj as Record<string, unknown>;
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_KEYS.has(key)) {
      extras[key] = value;
    }
  }

  const nested = source.providerOptions;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>), ...extras };
  }

  return extras;
}

export abstract class BaseGenerateDto {
  @IsString()
  @MaxLength(4096)
  prompt!: string;

  @IsOptional()
  @IsString()
  imageBase64?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  references?: string[];

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  outputLength?: number;

  @IsOptional()
  @IsNumber()
  topP?: number;

  @Allow()
  @Transform(({ obj }) => collectProviderOptions(obj), { toClassOnly: true })
  providerOptions: Record<string, unknown> = {};
}

export class ProviderGenerateDto extends BaseGenerateDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;
}

export { KNOWN_KEYS, collectProviderOptions };
