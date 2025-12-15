import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// import * as bcrypt from 'bcrypt';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.types';
import { SanitizedUser } from '../users/types';

export interface AuthResult {
  accessToken: string;
  user: SanitizedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  signUp(): Promise<AuthResult> {
    // This method is deprecated - use Supabase Auth instead
    throw new BadRequestException(
      'Please use /api/auth/supabase/signup instead',
    );
  }

  login(): Promise<AuthResult> {
    // This method is deprecated - use Supabase Auth instead
    throw new BadRequestException(
      'Please use /api/auth/supabase/login instead',
    );
  }

  async getProfile(userId: string): Promise<SanitizedUser> {
    const user = await this.usersService.findById(userId);
    return this.usersService.toSanitizedUser(user);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);

    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      return {
        message:
          'If an account with that email exists, we have sent a password reset link.',
      };
    }

    // Generate a password reset token
    const resetToken = await this.jwtService.signAsync(
      { sub: user.authUserId, type: 'password-reset' },
      { expiresIn: '1h' },
    );

    // Send email with reset link
    const resetUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    // TODO: Implement email sending service
    // Example with SendGrid:
    // await this.emailService.sendPasswordResetEmail(user.email, resetUrl);

    // For now, log the URL (remove in production)
    console.log(`Password reset URL for ${user.email}: ${resetUrl}`);

    return {
      message:
        'If an account with that email exists, we have sent a password reset link.',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    try {
      // Verify the reset token

      const payload = await this.jwtService.verifyAsync(dto.token);

      if (payload.type !== 'password-reset') {
        throw new BadRequestException('Invalid reset token');
      }

      const userId = payload.sub;

      const user = await this.usersService.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Update the user's password
      await this.usersService.updatePassword();

      return { message: 'Password has been successfully reset.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  private buildToken(user: SanitizedUser): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      authUserId: user.authUserId,
      email: user.email,
    };

    return this.jwtService.signAsync(payload);
  }
}
