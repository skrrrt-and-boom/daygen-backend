import { IsOptional, IsString } from 'class-validator';

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
}
