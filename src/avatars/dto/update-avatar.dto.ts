import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateAvatarImageDto {
    @IsOptional()
    @IsString()
    url?: string;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsString()
    sourceId?: string;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}

export class UpdateAvatarDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsString()
    sourceId?: string;

    @IsOptional()
    @IsBoolean()
    published?: boolean;
}

export class AddAvatarImageDto {
    @IsString()
    url: string;

    @IsString()
    source: string;

    @IsOptional()
    @IsString()
    sourceId?: string;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}
