import { IsEmail, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsUUID()
  authUserId: string;
}
