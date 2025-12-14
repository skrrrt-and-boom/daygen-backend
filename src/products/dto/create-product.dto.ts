import { IsString, IsOptional, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductImageDto {
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

export class CreateProductDto {
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
    @Type(() => CreateProductImageDto)
    images?: CreateProductImageDto[];
}
