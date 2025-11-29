import { IsString, IsNotEmpty } from 'class-validator';

export class GenerateTimelineDto {
    @IsString()
    @IsNotEmpty()
    topic: string;

    @IsString()
    @IsNotEmpty()
    style: string;

    @IsString()
    @IsNotEmpty()
    voiceId: string;

    @IsString()
    @IsNotEmpty()
    musicId: string;
}
