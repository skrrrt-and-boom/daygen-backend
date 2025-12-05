import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class RegenerateSegmentDto {
    @IsOptional()
    @IsString()
    prompt?: string;

    @IsOptional()
    @IsString()
    style?: string;

    @IsOptional()
    @IsString()
    text?: string;

    @IsOptional()
    @IsString()
    motionPrompt?: string;

    @IsOptional()
    @IsBoolean()
    regenerateImage?: boolean;

    @IsOptional()
    @IsBoolean()
    regenerateVideo?: boolean;
}
