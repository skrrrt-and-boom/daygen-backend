import { IsString, IsOptional, IsObject, IsNumber } from 'class-validator';

export class CreateImageUpscaleJobDto {
  @IsString()
  imageUrl: string;

  @IsString()
  model: string;

  @IsString()
  provider: string;

  @IsOptional()
  @IsNumber()
  scale?: number;

  @IsOptional()
  @IsObject()
  options?: Record<string, any>;
}
