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
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
