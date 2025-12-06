import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber } from 'class-validator';

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
    @IsNumber()
    musicVolume?: number;
}
