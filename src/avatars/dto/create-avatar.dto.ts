import { IsString, IsOptional, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAvatarImageDto {
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

export class CreateAvatarDto {
    @IsString()
    name: string;

    @IsString()
    imageUrl: string;

    @IsString()
    source: string;

    @IsOptional()
    @IsString()
    sourceId?: string;

    @IsOptional()
    @IsBoolean()
    published?: boolean;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateAvatarImageDto)
    images?: CreateAvatarImageDto[];
}
