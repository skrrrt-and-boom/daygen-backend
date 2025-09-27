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
import { IsString, IsOptional } from 'class-validator';
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
      const publicUrl = await this.r2Service.uploadBase64Image(
        dto.base64Data,
        dto.mimeType || 'image/png',
        dto.folder,
      );

      // Save R2File record to database
      const fileName = `image-${Date.now()}.${dto.mimeType?.split('/')[1] || 'png'}`;
      await this.r2FilesService.create(user.authUserId, {
        fileName,
        fileUrl: publicUrl,
        fileSize: Math.round((dto.base64Data.length * 3) / 4), // Approximate size
        mimeType: dto.mimeType || 'image/png',
        prompt: dto.prompt,
        model: dto.model,
      });

      return {
        success: true,
        url: publicUrl,
        mimeType: dto.mimeType || 'image/png',
      };
    } catch (error) {
      console.error('Base64 upload failed:', error);
      throw new BadRequestException('Failed to upload base64 image');
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
}
