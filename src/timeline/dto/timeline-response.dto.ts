import { IsNumber, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TimelineSegment {
    @IsNumber()
    index: number;

    @IsString()
    script: string;

    @IsString()
    visualPrompt: string;

    @IsString()
    voiceUrl: string;

    @IsNumber()
    duration: number;

    @IsNumber()
    startTime: number;

    @IsNumber()
    endTime: number;
}

export class TimelineResponse {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TimelineSegment)
    segments: TimelineSegment[];

    @IsNumber()
    totalDuration: number;
}
