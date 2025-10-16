import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MagicLinkSignUpDto } from './dto/magic-link-signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from '../users/users.service';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { SanitizedUser } from '../users/types';

export interface AuthResult {
  accessToken: string;
  user: SanitizedUser | null;
  needsEmailConfirmation?: boolean;
}

@Injectable()
export class SupabaseAuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
  ) {}

  async signUp(
    dto: MagicLinkSignUpDto,
  ): Promise<{ message: string; needsEmailConfirmation: boolean }> {
    const supabase = this.supabaseService.getClient();

    if (dto.password) {
      const { data, error } = await supabase.auth.signUp({
        email: dto.email,
        password: dto.password,
        options: {
          data: {
            display_name: dto.displayName,
          },
          emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
        },
      });

      if (error) {
        if (
          error.message.includes('already registered') ||
          error.message.includes('User already registered')
        ) {
          throw new ConflictException('Email is already registered');
        }
        throw new BadRequestException(error.message);
      }

      if (data.user) {
        try {
          await this.syncUserRecord(data.user, dto.displayName);
        } catch (syncError) {
          console.error('Failed to sync user profile after signup:', syncError);
        }
      }

      return {
        message: data.session
          ? 'Account created successfully.'
          : 'Check your email to confirm your account.',
        needsEmailConfirmation: !data.session,
      };
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: dto.email,
      options: {
        data: {
          display_name: dto.displayName,
        },
        emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
      },
    });

    if (error) {
      if (
        error.message.includes('already registered') ||
        error.message.includes('User already registered')
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw new BadRequestException(error.message);
    }

    return {
      message:
        'Check your email for the magic link to complete your registration.',
      needsEmailConfirmation: true,
    };
  }

  async signInWithPassword(dto: LoginDto): Promise<AuthResult> {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });

    if (error) {
      // If password is wrong, provide option for password reset
      if (error.message.includes('Invalid login credentials')) {
        throw new UnauthorizedException(
          'Invalid email or password. Use forgot password to reset your password.',
        );
      }
      throw new UnauthorizedException(error.message);
    }

    // Ensure user profile exists in our database
    let sanitized: SanitizedUser | null = null;
    try {
      if (data.user) {
        sanitized = await this.syncUserRecord(data.user);
      }
    } catch (profileError) {
      console.error('Error ensuring user profile:', profileError);
    }

    return {
      accessToken: data.session?.access_token || '',
      user: sanitized,
    };
  }

  async signInWithMagicLink(email: string): Promise<{ message: string }> {
    const { error } = await this.supabaseService
      .getClient()
      .auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
        },
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Check your email for the magic link to sign in.',
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const { error } = await this.supabaseService
      .getClient()
      .auth.resetPasswordForEmail(dto.email, {
        redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message:
        'If an account with that email exists, we have sent a password reset link.',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    // This should be called from the frontend after the user clicks the reset link
    const { error } = await this.supabaseService.getClient().auth.updateUser({
      password: dto.newPassword,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Password has been successfully reset.',
    };
  }

  async getProfile(accessToken: string): Promise<SanitizedUser> {
    try {
      const authUser = await this.supabaseService.getUserFromToken(accessToken);
      if (!authUser) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      return await this.syncUserRecord(authUser);
    } catch (profileError) {
      console.error('Error syncing user profile:', profileError);
      throw new UnauthorizedException('Unable to load user profile');
    }
  }

  async signOut(): Promise<{ message: string }> {
    const { error } = await this.supabaseService.getClient().auth.signOut();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Successfully signed out.',
    };
  }

  private async syncUserRecord(
    authUser: SupabaseAuthUser,
    displayNameOverride?: string | null,
  ): Promise<SanitizedUser> {
    return this.usersService.upsertFromSupabaseUser(authUser, {
      displayName: displayNameOverride ?? undefined,
    });
  }
}
