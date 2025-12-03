import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DesignVoiceDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}

export class CreateDesignedVoiceDto {
  @IsString()
  @IsNotEmpty()
  previewId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  audioBase64: string;
}

