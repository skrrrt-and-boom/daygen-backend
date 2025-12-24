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
import { SanitizedUser } from '../users/types';

const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
const fallbackJwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';

// Use SUPABASE_JWT_SECRET directly (not base64 decoded) as this is what Supabase uses
const jwtSecret = supabaseJwtSecret || fallbackJwtSecret;
const bearerTokenMatcher = /^Bearer\s+(.+)$/i;
const jwtFromRequest: JwtFromRequestFunction = (req: Request) => {
  const header = req?.headers?.authorization;

  if (!header) {
    return null;
  }

  const match = header.match(bearerTokenMatcher);
  const token = match?.[1] ?? null;
  return token;
};

// In-memory user cache to reduce database lookups
// TTL: 60 seconds, Max size: 1000 users
interface CacheEntry {
  user: SanitizedUser;
  expiresAt: number;
}

const USER_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const USER_CACHE_MAX_SIZE = 1000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private userCache = new Map<string, CacheEntry>();

  constructor(
    private readonly usersService: UsersService,
    private readonly supabaseService: SupabaseService,
  ) {
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      algorithms: ['HS256'],
    } as StrategyOptionsWithoutRequest);
  }

  private getCachedUser(authUserId: string): SanitizedUser | null {
    const entry = this.userCache.get(authUserId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.userCache.delete(authUserId);
      return null;
    }

    return entry.user;
  }

  private setCachedUser(authUserId: string, user: SanitizedUser): void {
    // Evict oldest entries if cache is full
    if (this.userCache.size >= USER_CACHE_MAX_SIZE) {
      const firstKey = this.userCache.keys().next().value;
      if (firstKey) this.userCache.delete(firstKey);
    }

    this.userCache.set(authUserId, {
      user,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    });
  }

  /**
   * Invalidate the cache for a specific user.
   * Call this when a user's profile is updated.
   */
  invalidateUserCache(authUserId: string): void {
    this.userCache.delete(authUserId);
  }

  async validate(payload: JwtPayload) {
    // Check if the user has the authenticated role
    if (payload.role !== 'authenticated') {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const authUserId = payload.sub ?? payload.authUserId;

    if (!authUserId) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    // Check cache first
    const cachedUser = this.getCachedUser(authUserId);
    if (cachedUser) {
      return cachedUser;
    }

    const existing = await this.usersService.findByAuthUserIdOrNull(authUserId);
    if (existing) {
      const sanitizedUser = this.usersService.toSanitizedUser(existing);
      this.setCachedUser(authUserId, sanitizedUser);
      return sanitizedUser;
    }

    try {
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .auth.admin.getUserById(authUserId);

      if (error || !data?.user) {
        throw new UnauthorizedException('Session is no longer valid');
      }

      const newUser = await this.usersService.upsertFromSupabaseUser(data.user);
      this.setCachedUser(authUserId, newUser);
      return newUser;
    } catch {
      throw new UnauthorizedException('Session is no longer valid');
    }
  }
}

