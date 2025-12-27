import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FileInterceptor } from '@nestjs/platform-express';
import { R2Service } from './r2.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser as CurrentUserDecorator } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { R2FilesService } from '../r2files/r2files.service';

class UploadFileDto {
  @IsOptional()
  @IsString()
  folder?: string;
}

class UploadBase64Dto {
  @IsString()
  base64Data: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  avatarId?: string;

  @IsOptional()
  @IsString()
  productId?: string;
}

class PresignedUploadDto {
  @IsString()
  fileName: string;

  @IsString()
  contentType: string;

  @IsOptional()
  @IsString()
  folder?: string;
}

class MigrateBase64ImageDto {
  @IsString()
  base64Data: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  originalUrl?: string; // The original base64 URL for mapping
}

class MigrateBase64BatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MigrateBase64ImageDto)
  images: MigrateBase64ImageDto[];
}

class ProxyImageDto {
  @IsString()
  url: string;
}

@Controller('upload')
export class UploadController {
  constructor(
    private readonly r2Service: R2Service,
    private readonly r2FilesService: R2FilesService,
  ) {}

  @Get('status')
  getStatus() {
    return {
      configured: this.r2Service.isConfigured(),
      bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'not-set',
      accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID ? 'set' : 'not-set',
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ? 'set' : 'not-set',
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
        ? 'set'
        : 'not-set',
      publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || 'not-set',
    };
  }

  @Post('file')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    try {
      const publicUrl = await this.r2Service.uploadFile(file, dto.folder);

      return {
        success: true,
        url: publicUrl,
        fileName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      };
    } catch (error) {
      console.error('Upload failed:', error);
      throw new BadRequestException('Failed to upload file');
    }
  }

  @Post('base64')
  @UseGuards(JwtAuthGuard)
  async uploadBase64(
    @Body() dto: UploadBase64Dto,
    @CurrentUserDecorator() user: SanitizedUser,
  ) {
    console.log(
      'Received base64 upload request:',
      JSON.stringify(dto, null, 2),
    );
    if (!dto.base64Data) {
      throw new BadRequestException('No base64 data provided');
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    try {
      const mimeType = dto.mimeType || 'image/png';
      const publicUrl = await this.r2Service.uploadBase64Image(
        dto.base64Data,
        mimeType,
        dto.folder,
      );

      // Save R2File record to database (skip if this is an avatar/product image - those get their own records via the avatar/product endpoints)
      // Only create R2File if no avatarId or productId is specified (those flows handle their own R2File creation)
      if (!dto.avatarId && !dto.productId) {
        // Determine file prefix based on MIME type
        const filePrefix = mimeType.startsWith('audio/')
          ? 'audio'
          : mimeType.startsWith('video/')
            ? 'video'
            : 'image';
        const extension = mimeType.split('/')[1] || 'bin';
        const fileName = `${filePrefix}-${Date.now()}.${extension}`;
        await this.r2FilesService.create(user.authUserId, {
          fileName,
          fileUrl: publicUrl,
          fileSize: Math.round((dto.base64Data.length * 3) / 4), // Approximate size
          mimeType,
          prompt: dto.prompt,
          model: dto.model,
        });
      }

      return {
        success: true,
        url: publicUrl,
        mimeType,
      };
    } catch (error) {
      console.error('Base64 upload failed:', error);
      throw new BadRequestException('Failed to upload base64 file');
    }
  }

  @Post('presigned')
  @UseGuards(JwtAuthGuard)
  async generatePresignedUrl(@Body() dto: PresignedUploadDto) {
    if (!dto.fileName || !dto.contentType) {
      throw new BadRequestException('fileName and contentType are required');
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    try {
      const { uploadUrl, publicUrl } =
        await this.r2Service.generatePresignedUploadUrl(
          dto.fileName,
          dto.contentType,
          dto.folder,
        );

      return {
        success: true,
        uploadUrl,
        publicUrl,
        fileName: dto.fileName,
        contentType: dto.contentType,
      };
    } catch (error) {
      console.error('Presigned URL generation failed:', error);
      throw new BadRequestException('Failed to generate presigned URL');
    }
  }

  @Post('delete')
  @UseGuards(JwtAuthGuard)
  async deleteFile(@Body() body: { url: string }) {
    if (!body.url) {
      throw new BadRequestException('URL is required');
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    try {
      const success = await this.r2Service.deleteFile(body.url);

      return {
        success,
        url: body.url,
      };
    } catch (error) {
      console.error('Delete failed:', error);
      throw new BadRequestException('Failed to delete file');
    }
  }

  @Post('migrate-base64-batch')
  @UseGuards(JwtAuthGuard)
  async migrateBase64Batch(
    @Body() dto: MigrateBase64BatchDto,
    @CurrentUserDecorator() user: SanitizedUser,
  ) {
    if (!dto.images || !Array.isArray(dto.images) || dto.images.length === 0) {
      throw new BadRequestException(
        'Images array is required and must not be empty',
      );
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    const results: Array<{
      index: number;
      originalUrl?: string;
      newUrl: string;
      r2FileId: string;
      success: boolean;
    }> = [];
    const errors: Array<{
      index: number;
      originalUrl?: string;
      error: string;
    }> = [];

    for (let i = 0; i < dto.images.length; i++) {
      const image = dto.images[i];

      try {
        // Validate base64 data
        if (!image.base64Data || !image.base64Data.startsWith('data:image/')) {
          errors.push({
            index: i,
            originalUrl: image.originalUrl,
            error: 'Invalid base64 data format',
          });
          continue;
        }

        // Extract base64 data and mime type
        const base64Match = image.base64Data.match(
          /^data:([^;,]+);base64,(.*)$/,
        );
        if (!base64Match) {
          errors.push({
            index: i,
            originalUrl: image.originalUrl,
            error: 'Invalid base64 data URL format',
          });
          continue;
        }

        const [, mimeType, base64Data] = base64Match;
        const finalMimeType = image.mimeType || mimeType || 'image/png';

        // Upload to R2
        const publicUrl = await this.r2Service.uploadBase64Image(
          base64Data,
          finalMimeType,
          'migrated-images',
        );

        // Create R2File record
        const fileName = `migrated-${Date.now()}-${i}.${finalMimeType.split('/')[1] || 'png'}`;
        const r2File = await this.r2FilesService.create(user.authUserId, {
          fileName,
          fileUrl: publicUrl,
          fileSize: Math.round((base64Data.length * 3) / 4),
          mimeType: finalMimeType,
          prompt: image.prompt,
          model: image.model,
        });

        results.push({
          index: i,
          originalUrl: image.originalUrl,
          newUrl: publicUrl,
          r2FileId: r2File.id,
          success: true,
        });
      } catch (error) {
        console.error(`Failed to migrate image ${i}:`, error);
        errors.push({
          index: i,
          originalUrl: image.originalUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      success: errors.length === 0,
      totalImages: dto.images.length,
      successfulMigrations: results.length,
      failedMigrations: errors.length,
      results,
      errors,
    };
  }

  @Post('proxy-image')
  @UseGuards(JwtAuthGuard)
  async proxyImage(@Body() dto: ProxyImageDto) {
    if (!dto.url) {
      throw new BadRequestException('URL is required');
    }

    try {
      // Validate URL
      const url = new URL(dto.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadRequestException('Only HTTP and HTTPS URLs are allowed');
      }

      // Fetch the image
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        const response = await fetch(dto.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Daygen-Image-Proxy/1.0',
          },
        });

        if (!response.ok) {
          throw new BadRequestException(
            `Failed to fetch image: ${response.status} ${response.statusText}`,
          );
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
          throw new BadRequestException(`URL does not point to an image: ${contentType}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');

        clearTimeout(timer);

        return {
          success: true,
          dataUrl: `data:${contentType};base64,${base64}`,
          mimeType: contentType,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Image proxy failed:', error);
      throw new BadRequestException(
        `Failed to proxy image: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
