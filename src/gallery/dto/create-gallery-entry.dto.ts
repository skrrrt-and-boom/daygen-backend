import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGalleryEntryDto {
  @IsString()
  @MaxLength(2048)
  assetUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
