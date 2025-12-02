import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

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
}
