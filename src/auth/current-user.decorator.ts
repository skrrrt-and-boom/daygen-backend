import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SanitizedUser } from '../users/types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SanitizedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as SanitizedUser;
  },
);
