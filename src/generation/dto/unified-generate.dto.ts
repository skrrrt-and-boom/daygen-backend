import { IsString, MaxLength } from 'class-validator';
import { BaseGenerateDto } from './base-generate.dto';

export class UnifiedGenerateDto extends BaseGenerateDto {
  @IsString()
  @MaxLength(128)
  model!: string;
}
