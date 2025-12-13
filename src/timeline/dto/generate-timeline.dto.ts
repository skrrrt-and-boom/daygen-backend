import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class GenerateTimelineDto {
    @IsString()
    @IsNotEmpty()
    topic: string;

    @IsString()
    @IsNotEmpty()
    style: string;

    @IsOptional()
    @IsString()
    voiceId?: string;

    @IsOptional()
    @IsBoolean()
    includeNarration?: boolean = true;

    @IsOptional()
    @IsBoolean()
    includeSubtitles?: boolean = true;

    @IsString()
    @IsOptional()
    duration?: 'short' | 'medium' | 'long';

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    referenceImageUrls?: string[];
}
