import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SignUpDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @ValidateIf((o) => o.password !== undefined)
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must be no more than 128 characters long' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}
