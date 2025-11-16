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
import { R2FilesService } from './r2files.service';
import type { CreateR2FileDto } from './r2files.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@UseGuards(JwtAuthGuard)
@Controller('r2files')
export class R2FilesController {
  constructor(private readonly r2FilesService: R2FilesService) {}

  @Get()
  list(
    @CurrentUser() user: SanitizedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.r2FilesService.list(
      user.authUserId,
      parsedLimit,
      cursor ?? undefined,
    );
  }

  @Post()
  create(@CurrentUser() user: SanitizedUser, @Body() dto: CreateR2FileDto) {
    return this.r2FilesService.create(user.authUserId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
    return this.r2FilesService.remove(user.authUserId, id);
  }
}
