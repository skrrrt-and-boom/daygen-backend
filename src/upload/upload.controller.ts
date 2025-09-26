import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { R2Service } from './r2.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser as CurrentUserDecorator } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

class UploadFileDto {
  folder?: string;
}

class UploadBase64Dto {
  base64Data: string;
  mimeType?: string;
  folder?: string;
}

class PresignedUploadDto {
  fileName: string;
  contentType: string;
  folder?: string;
}

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly r2Service: R2Service) {}

  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentUserDecorator() user: SanitizedUser,
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
  async uploadBase64(
    @Body() dto: UploadBase64Dto,
    @CurrentUserDecorator() user: SanitizedUser,
  ) {
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
  async generatePresignedUrl(
    @Body() dto: PresignedUploadDto,
    @CurrentUserDecorator() user: SanitizedUser,
  ) {
    if (!dto.fileName || !dto.contentType) {
      throw new BadRequestException('fileName and contentType are required');
    }

    if (!this.r2Service.isConfigured()) {
      throw new BadRequestException('R2 storage not configured');
    }

    try {
      const { uploadUrl, publicUrl } = await this.r2Service.generatePresignedUploadUrl(
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
  async deleteFile(
    @Body() body: { url: string },
    @CurrentUserDecorator() user: SanitizedUser,
  ) {
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
