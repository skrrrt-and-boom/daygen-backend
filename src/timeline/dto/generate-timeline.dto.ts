import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsNumber } from 'class-validator';

export class GenerateTimelineDto {
    @IsString()
    @IsNotEmpty()
    topic: string;

    @IsString()
    @IsOptional()
    style?: string;

    @IsOptional()
    @IsString()
    voiceId?: string;

    @IsOptional()
    @IsBoolean()
    includeNarration?: boolean = true;

    @IsBoolean()
    @IsOptional()
    includeSubtitles?: boolean;

    @IsNumber()
    @IsOptional()
    musicStartTime?: number;

    @IsString()
    @IsOptional()
    duration?: 'short' | 'medium' | 'long';

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    referenceImageUrls?: string[];

    @IsOptional()
    @IsString()
    musicUrl?: string;

    @IsOptional()
    @IsNumber()
    musicVolume?: number;
}
