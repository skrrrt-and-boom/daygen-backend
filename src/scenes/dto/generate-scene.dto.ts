import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class GenerateSceneDto {
  @ValidateIf((dto) => !dto.styleOptionId)
  @IsString()
  @MaxLength(64)
  sceneTemplateId?: string;

  @ValidateIf((dto) => !dto.sceneTemplateId)
  @IsString()
  @MaxLength(128)
  styleOptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stylePreset?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DEFAULT', 'TURBO'])
  @MaxLength(24)
  renderingSpeed?: 'DEFAULT' | 'TURBO';

  @IsOptional()
  @IsString()
  @MaxLength(280)
  personalizationNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @IsIn(['portrait', 'landscape', 'square'], {
    message: 'characterFocus must be portrait, landscape, or square',
  })
  characterFocus?: 'portrait' | 'landscape' | 'square';

  @IsOptional()
  @IsString()
  @IsIn(['AUTO', 'REALISTIC', 'FICTION'])
  styleType?: 'AUTO' | 'REALISTIC' | 'FICTION';
}

