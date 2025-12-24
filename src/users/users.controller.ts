import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Headers,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from './types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { JwtStrategy } from '../auth/jwt.strategy';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly supabaseService: SupabaseService,
    @Inject(forwardRef(() => JwtStrategy)) private readonly jwtStrategy: JwtStrategy,
  ) { }

  @Post('me')
  async createUserProfile(
    @Headers('authorization') authorization: string,
    @Body() body: { email: string; displayName?: string; authUserId: string },
  ) {
    const token = authorization?.replace('Bearer ', '');
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const authUser = await this.supabaseService.getUserFromToken(token);
      if (!authUser) {
        throw new Error('Invalid or expired token');
      }

      return this.usersService.upsertFromSupabaseUser(authUser, {
        displayName: body.displayName,
      });
    } catch (error) {
      console.error('Error creating user profile:', error);
      throw new Error('Failed to create user profile');
    }
  }

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
  async updateProfile(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const updatedUser = await this.usersService.updateProfile(user.authUserId, dto);
    // Invalidate the JWT strategy cache so the next request fetches fresh data
    this.jwtStrategy.invalidateUserCache(user.authUserId);
    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/profile-picture')
  async uploadProfilePicture(
    @CurrentUser() user: SanitizedUser,
    @Body() body: { base64Data: string; mimeType?: string },
  ) {
    const updatedUser = await this.usersService.uploadProfilePicture(
      user.authUserId,
      body.base64Data,
      body.mimeType,
    );
    this.jwtStrategy.invalidateUserCache(user.authUserId);
    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/remove-profile-picture')
  async removeProfilePicture(@CurrentUser() user: SanitizedUser) {
    const updatedUser = await this.usersService.removeProfilePicture(user.authUserId);
    this.jwtStrategy.invalidateUserCache(user.authUserId);
    return updatedUser;
  }

  /**
   * Lookup a user by their username for public profile URLs
   * No auth required - public endpoint
   */
  @Get('by-username/:username')
  async getUserByUsername(@Param('username') username: string) {
    if (!username) {
      throw new NotFoundException('Username is required');
    }

    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Return only public profile fields
    return {
      id: user.authUserId,
      username: user.username,
      displayName: user.displayName,
      profileImage: user.profileImage,
      bio: user.bio,
      country: user.country,
    };
  }
}
