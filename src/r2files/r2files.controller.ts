import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Res,
  StreamableFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { R2FilesService } from './r2files.service';
import type { CreateR2FileDto, UpdateR2FileDto } from './r2files.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('r2files')
export class R2FilesController {
  constructor(private readonly r2FilesService: R2FilesService) { }

  // Proxy endpoint to fetch images with CORS headers for clipboard copy
  // Public endpoint - no auth required
  @Get('proxy')
  async proxyImage(
    @Query('url') url: string,
    @Res({ passthrough: true }) res: any,
  ) {
    if (!url) {
      throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new HttpException(
          `Failed to fetch image: ${response.statusText}`,
          response.status,
        );
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.from(await response.arrayBuffer());

      // Set CORS headers to allow creating a blob from the response
      res.set({
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=31536000',
      });

      return new StreamableFile(buffer);
    } catch (error) {
      throw new HttpException(
        `Failed to proxy image: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Public endpoint to list all public generations for the Explore gallery
  // Optional auth to check for likes
  @UseGuards(OptionalJwtAuthGuard)
  @Get('public')
  listPublic(
    @CurrentUser() user: SanitizedUser | null,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.r2FilesService.listPublic(
      parsedLimit,
      cursor ?? undefined,
      user?.authUserId,
    );
  }

  // Public endpoint to list a specific user's public generations for creator profile modal
  // Optional auth to check for likes
  @UseGuards(OptionalJwtAuthGuard)
  @Get('public/user/:userId')
  listPublicByUser(
    @CurrentUser() user: SanitizedUser | null,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.r2FilesService.listPublicByUser(
      userId,
      parsedLimit,
      cursor ?? undefined,
      user?.authUserId,
    );
  }

  // Public endpoint to get a specific public file by ID
  // Optional auth to check for likes
  @UseGuards(OptionalJwtAuthGuard)
  @Get('public/:id')
  async getPublicById(
    @CurrentUser() user: SanitizedUser | null,
    @Param('id') id: string,
  ) {
    const file = await this.r2FilesService.findPublicById(id, user?.authUserId);
    if (!file) {
      throw new HttpException('File not found', HttpStatus.NOT_FOUND);
    }
    return file;
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/toggle-like')
  async toggleLike(
    @CurrentUser() user: SanitizedUser,
    @Param('id') id: string,
  ) {
    return this.r2FilesService.toggleLike(user.authUserId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: SanitizedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: 'image' | 'video',
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.r2FilesService.list(
      user.authUserId,
      parsedLimit,
      cursor ?? undefined,
      type,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: SanitizedUser, @Body() dto: CreateR2FileDto) {
    return this.r2FilesService.create(user.authUserId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('by-url')
  updateByUrl(
    @CurrentUser() user: SanitizedUser,
    @Body() body: { fileUrl?: string } & UpdateR2FileDto,
  ) {
    const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl.trim() : '';
    if (!fileUrl) {
      throw new HttpException('fileUrl is required', HttpStatus.BAD_REQUEST);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fileUrl: _, ...dto } = body;
    return this.r2FilesService.updateByFileUrl(user.authUserId, fileUrl, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: SanitizedUser,
    @Param('id') id: string,
    @Body() dto: UpdateR2FileDto,
  ) {
    return this.r2FilesService.update(user.authUserId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('by-url')
  removeByUrl(
    @CurrentUser() user: SanitizedUser,
    @Body() body: { fileUrl: string },
  ) {
    const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl.trim() : '';
    if (!fileUrl) {
      throw new HttpException('fileUrl is required', HttpStatus.BAD_REQUEST);
    }
    return this.r2FilesService.removeByFileUrl(user.authUserId, fileUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
    return this.r2FilesService.remove(user.authUserId, id);
  }
}
