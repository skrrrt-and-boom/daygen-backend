import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type JwtFromRequestFunction,
  type StrategyOptionsWithoutRequest,
} from 'passport-jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.types';
import { SupabaseService } from '../supabase/supabase.service';

const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
const fallbackJwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';

const jwtSecret = supabaseJwtSecret
  ? Buffer.from(supabaseJwtSecret, 'base64')
  : fallbackJwtSecret;
const bearerTokenMatcher = /^Bearer\s+(.+)$/i;
const jwtFromRequest: JwtFromRequestFunction = (req: Request) => {
  const header = req?.headers?.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(bearerTokenMatcher);
  return match?.[1] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    private readonly supabaseService: SupabaseService,
  ) {
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    } as StrategyOptionsWithoutRequest);
  }

  async validate(payload: JwtPayload) {
    const authUserId = payload.sub ?? payload.authUserId;

    if (!authUserId) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const existing = await this.usersService.findByAuthUserIdOrNull(authUserId);
    if (existing) {
      return this.usersService.toSanitizedUser(existing);
    }

    try {
      const { data, error } =
        await this.supabaseService
          .getAdminClient()
          .auth.admin.getUserById(authUserId);

      if (error || !data?.user) {
        throw new UnauthorizedException('Session is no longer valid');
      }

      return await this.usersService.upsertFromSupabaseUser(data.user);
    } catch (error) {
      console.error('Failed to synchronize Supabase user:', error);
      throw new UnauthorizedException('Session is no longer valid');
    }
  }
}
