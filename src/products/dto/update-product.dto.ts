import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateProductDto {
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

export class AddProductImageDto {
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
