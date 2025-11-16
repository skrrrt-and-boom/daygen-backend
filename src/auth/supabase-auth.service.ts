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

  async devLogin(): Promise<AuthResult> {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('Dev login not available in production');
    }

    const DEV_EMAIL = 'dev@daygen.ai';
    const DEV_PASSWORD = 'devpassword123';
    const DEV_DISPLAY_NAME = 'Dev User';

    const adminClient = this.supabaseService.getAdminClient();

    // Try to find existing dev user
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const devUser = existingUsers?.users?.find(
      (u: SupabaseAuthUser) => u.email === DEV_EMAIL,
    );

    // If dev user doesn't exist, create it
    if (!devUser) {
      console.log('Creating dev user...');
      const { data: newUserData, error: createError } =
        await adminClient.auth.admin.createUser({
          email: DEV_EMAIL,
          password: DEV_PASSWORD,
          email_confirm: true,
          user_metadata: {
            display_name: DEV_DISPLAY_NAME,
          },
        });

      // Handle case where user already exists (race condition or list didn't find them)
      if (
        createError &&
        createError.message?.includes('already been registered')
      ) {
        console.log('Dev user already exists, proceeding to sign in...');
      } else if (createError) {
        console.error('Error creating dev user:', createError);
        throw new BadRequestException(
          `Failed to create dev user: ${createError.message}`,
        );
      } else if (newUserData.user) {
        // Sync to our database
        await this.syncUserRecord(newUserData.user, DEV_DISPLAY_NAME);
      }
    }

    // Sign in as the dev user
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({
        email: DEV_EMAIL,
        password: DEV_PASSWORD,
      });

    if (error) {
      throw new UnauthorizedException(`Dev login failed: ${error.message}`);
    }

    // Ensure user profile exists in our database
    let sanitized: SanitizedUser | null = null;
    try {
      if (data.user) {
        sanitized = await this.syncUserRecord(data.user, DEV_DISPLAY_NAME);
      }
    } catch (profileError) {
      console.error('Error ensuring dev user profile:', profileError);
    }

    return {
      accessToken: data.session?.access_token || '',
      user: sanitized,
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
