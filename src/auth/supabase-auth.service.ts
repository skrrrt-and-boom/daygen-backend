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

export interface AuthResult {
  accessToken: string;
  user: any;
  needsEmailConfirmation?: boolean;
}

@Injectable()
export class SupabaseAuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async signUp(dto: MagicLinkSignUpDto): Promise<{ message: string }> {
    // Use magic link for signup - no password required
    const { error } = await this.supabaseService.getClient().auth.signInWithOtp({
      email: dto.email,
      options: {
        data: {
          display_name: dto.displayName,
        },
        emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
      },
    });

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('User already registered')) {
        throw new ConflictException('Email is already registered');
      }
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Check your email for the magic link to complete your registration.',
    };
  }

  async signInWithPassword(dto: LoginDto): Promise<AuthResult> {
    const { data, error } = await this.supabaseService.getClient().auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      // If password is wrong, provide option for password reset
      if (error.message.includes('Invalid login credentials')) {
        throw new UnauthorizedException('Invalid email or password. Use forgot password to reset your password.');
      }
      throw new UnauthorizedException(error.message);
    }

    // Ensure user profile exists in our database
    try {
      await this.ensureUserProfilePrivate(data.user);
    } catch (profileError) {
      console.error('Error ensuring user profile:', profileError);
    }

    return {
      accessToken: data.session?.access_token || '',
      user: data.user,
    };
  }

  async signInWithMagicLink(email: string): Promise<{ message: string }> {
    const { error } = await this.supabaseService.getClient().auth.signInWithOtp({
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
    const { error } = await this.supabaseService.getClient().auth.resetPasswordForEmail(
      dto.email,
      {
        redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
      }
    );

    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'If an account with that email exists, we have sent a password reset link.',
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

  async getProfile(accessToken: string): Promise<any> {
    const { data: { user }, error } = await this.supabaseService.getClient().auth.getUser(accessToken);
    
    if (error || !user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Get user profile from our database
    try {
      const profile = await this.supabaseService.getUserProfile(user.id);
      return {
        ...user,
        ...profile,
      };
    } catch (profileError) {
      // If profile doesn't exist, create it
      try {
        const profile = await this.supabaseService.createUserProfile(user, {
          displayName: user.user_metadata?.display_name || user.email?.split('@')[0],
        });
        return {
          ...user,
          ...profile,
        };
      } catch (createError) {
        console.error('Error creating user profile:', createError);
        return user;
      }
    }
  }

  async signOut(accessToken: string): Promise<{ message: string }> {
    const { error } = await this.supabaseService.getClient().auth.signOut();
    
    if (error) {
      throw new BadRequestException(error.message);
    }

    return {
      message: 'Successfully signed out.',
    };
  }

  async ensureUserProfile(authUser: any): Promise<void> {
    try {
      await this.supabaseService.getUserProfile(authUser.id);
    } catch (error) {
      // Profile doesn't exist, create it
      await this.supabaseService.createUserProfile(authUser, {
        displayName: authUser.user_metadata?.display_name || authUser.email?.split('@')[0],
      });
    }
  }

  private async ensureUserProfilePrivate(authUser: any): Promise<void> {
    try {
      await this.supabaseService.getUserProfile(authUser.id);
    } catch (error) {
      // Profile doesn't exist, create it
      await this.supabaseService.createUserProfile(authUser);
    }
  }
}
