import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type JwtFromRequestFunction,
  type StrategyOptions,
} from 'passport-jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.types';

const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';
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
  constructor(private readonly usersService: UsersService) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    super({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- passport-jwt expects a function here
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    } as StrategyOptions);
  }

  async validate(payload: JwtPayload) {
    try {
      const user = await this.usersService.findById(payload.sub);
      if (!user || user.authUserId !== payload.authUserId) {
        throw new UnauthorizedException('Session is no longer valid');
      }

      return this.usersService.toSanitizedUser(user);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Session is no longer valid');
      }
      throw error;
    }
  }
}
