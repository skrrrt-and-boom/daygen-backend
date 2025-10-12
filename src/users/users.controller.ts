import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from './types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: SanitizedUser) {
    return user;
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('balances')
  listBalances(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.usersService.listBalances(parsedLimit);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.authUserId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/profile-picture')
  async uploadProfilePicture(
    @CurrentUser() user: SanitizedUser,
    @Body() body: { base64Data: string; mimeType?: string },
  ) {
    return this.usersService.uploadProfilePicture(
      user.authUserId,
      body.base64Data,
      body.mimeType,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/remove-profile-picture')
  async removeProfilePicture(@CurrentUser() user: SanitizedUser) {
    return this.usersService.removeProfilePicture(user.authUserId);
  }
}
