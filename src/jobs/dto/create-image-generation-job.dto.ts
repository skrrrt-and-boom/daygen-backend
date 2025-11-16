import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateImageGenerationJobDto {
  @IsString()
  prompt: string;

  @IsString()
  model: string;

  @IsString()
  provider: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, any>;
}
