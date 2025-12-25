import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { PromptType } from '@prisma/client';

export class CreatePromptDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(3, { message: 'Prompt must be at least 3 characters' })
    text: string;

    @IsEnum(PromptType)
    type: PromptType;
}
