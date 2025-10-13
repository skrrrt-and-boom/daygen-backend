import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class MagicLinkSignUpDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}
