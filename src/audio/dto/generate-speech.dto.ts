import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateSpeechDto {
  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  voiceId?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  stability?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityBoost?: number;
}

