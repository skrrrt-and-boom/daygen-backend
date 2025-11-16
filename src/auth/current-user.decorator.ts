import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SanitizedUser } from '../users/types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SanitizedUser => {
    const { user } = ctx.switchToHttp().getRequest<{ user?: SanitizedUser }>();
    return user as SanitizedUser;
  },
);
