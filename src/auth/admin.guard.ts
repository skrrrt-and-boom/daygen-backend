import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SanitizedUser } from '../users/types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SanitizedUser }>();
    const user = request.user;
    if (user?.role === 'ADMIN') {
      return true;
    }
    throw new ForbiddenException('Admin privileges required');
  }
}
