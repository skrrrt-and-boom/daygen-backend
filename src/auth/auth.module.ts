import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { GoogleAuthService } from './google-auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { JwtStrategy } from './jwt.strategy';
import { AdminGuard } from './admin.guard';

const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';

@Module({
  imports: [
    UsersModule,
    SupabaseModule,
    PassportModule,
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthService, GoogleAuthService, JwtStrategy, AdminGuard],
  exports: [AuthService, SupabaseAuthService, GoogleAuthService, AdminGuard],
})
export class AuthModule {}
