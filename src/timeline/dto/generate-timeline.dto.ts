import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
}
