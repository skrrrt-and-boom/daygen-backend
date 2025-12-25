import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpdatePromptDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(3, { message: 'Prompt must be at least 3 characters' })
    text: string;
}
