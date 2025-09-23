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

function collectProviderOptions(obj: Record<string, unknown> | undefined) {
  if (!obj) {
    return {};
  }
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      extras[key] = value;
    }
  }
  return extras;
}

export class UnifiedGenerateDto {
  @IsString()
  @MaxLength(4096)
  prompt!: string;

  @IsString()
  @MaxLength(128)
  model!: string;

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
