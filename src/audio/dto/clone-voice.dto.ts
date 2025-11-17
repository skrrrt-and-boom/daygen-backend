import { IsOptional, IsString } from 'class-validator';

export class CloneVoiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  labels?: string;
}


