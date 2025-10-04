import { IsString, IsOptional, IsObject, IsArray, IsNumber } from 'class-validator';

export class CreateBatchGenerationJobDto {
  @IsArray()
  @IsString({ each: true })
  prompts: string[];

  @IsString()
  model: string;

  @IsString()
  provider: string;

  @IsOptional()
  @IsNumber()
  batchSize?: number;

  @IsOptional()
  @IsObject()
  options?: Record<string, any>;
}
