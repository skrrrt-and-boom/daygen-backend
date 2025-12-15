import { IsString, IsOptional, IsObject, IsArray } from 'class-validator';

export class CreateVideoGenerationJobDto {
  @IsString()
  prompt: string;

  @IsString()
  model: string;

  @IsString()
  provider: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, any>;

  @IsOptional()
  @IsString()
  avatarId?: string;

  @IsOptional()
  @IsString()
  avatarImageId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  references?: string[];

  @IsOptional()
  @IsString()
  script?: string;

  @IsOptional()
  @IsString()
  voiceId?: string;
}
