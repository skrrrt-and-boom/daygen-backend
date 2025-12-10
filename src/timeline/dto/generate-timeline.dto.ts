import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class GenerateTimelineDto {
    @IsString()
    @IsNotEmpty()
    topic: string;

    @IsString()
    @IsNotEmpty()
    style: string;

    @IsString()
    @IsOptional()
    voiceId?: string;

    @IsString()
    @IsOptional()
    musicId?: string;

    @IsOptional()
    @IsBoolean()
    includeNarration?: boolean = true;

    @IsString()
    @IsOptional()
    duration?: 'short' | 'medium' | 'long';

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    referenceImageUrls?: string[];
}
