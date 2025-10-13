import { Body, Controller, Get, Post, UseGuards, Headers, Query, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SignUpDto } from './dto/signup.dto';
import { MagicLinkSignUpDto } from './dto/magic-link-signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseAuthService: SupabaseAuthService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('signup')
  signUp(@Body() dto: MagicLinkSignUpDto) {
    return this.supabaseAuthService.signUp(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.supabaseAuthService.signInWithPassword(dto);
  }


  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    console.log('🔑 Forgot password endpoint called with email:', dto.email);
    return this.supabaseAuthService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.supabaseAuthService.resetPassword(dto);
  }

  @Post('magic-link')
  magicLink(@Body() dto: { email: string }) {
    return this.supabaseAuthService.signInWithMagicLink(dto.email);
  }

  @Get('me')
  async me(@Headers('authorization') authorization: string) {
    const token = authorization?.replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    return this.supabaseAuthService.getProfile(token);
  }

  @Post('signout')
  async signOut(@Headers('authorization') authorization: string) {
    const token = authorization?.replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    return this.supabaseAuthService.signOut(token);
  }

  // Google OAuth endpoint
  @Post('google')
  async googleAuth() {
    const { data, error } = await this.supabaseService.getClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { authUrl: data.url };
  }

  // Auth callback endpoint for handling magic links and email confirmations
  @Get('callback')
  async authCallback(@Query('access_token') accessToken: string, @Query('refresh_token') refreshToken: string) {
    if (!accessToken) {
      throw new BadRequestException('No access token provided');
    }

    // Verify the token and get user info
    const user = await this.supabaseAuthService.getProfile(accessToken);
    
    // Ensure user profile is created in our database
    try {
      await this.supabaseAuthService.ensureUserProfile(user);
    } catch (profileError) {
      console.error('Error ensuring user profile:', profileError);
    }
    
    return {
      message: 'Authentication successful',
      user,
      accessToken,
      refreshToken,
    };
  }

  // OAuth callback handler for frontend
  @Post('oauth-callback')
  async oauthCallback(@Body() body: { access_token: string; refresh_token?: string }) {
    const { access_token, refresh_token } = body;
    
    if (!access_token) {
      throw new BadRequestException('No access token provided');
    }

    // Verify the token and get user info
    const user = await this.supabaseAuthService.getProfile(access_token);
    
    // Ensure user profile is created in our database
    try {
      await this.supabaseAuthService.ensureUserProfile(user);
    } catch (profileError) {
      console.error('Error ensuring user profile:', profileError);
    }
    
    return {
      message: 'Authentication successful',
      user,
      accessToken: access_token,
      refreshToken: refresh_token,
    };
  }
}
