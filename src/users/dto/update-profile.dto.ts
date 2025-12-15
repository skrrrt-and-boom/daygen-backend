import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
