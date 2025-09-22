import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { CreateGalleryEntryDto } from './dto/create-gallery-entry.dto';

@UseGuards(JwtAuthGuard)
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  list(
    @CurrentUser() user: SanitizedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.galleryService.list(
      user.authUserId,
      parsedLimit,
      cursor ?? undefined,
    );
  }

  @Post()
  create(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: CreateGalleryEntryDto,
  ) {
    return this.galleryService.create(user.authUserId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
    return this.galleryService.remove(user.authUserId, id);
  }
}
