import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UsageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SanitizedUser } from '../users/types';

interface UsageEventInput {
  provider: string;
  model?: string;
  prompt?: string;
  cost?: number;
  metadata?: Record<string, unknown>;
}

interface UsageEventResult {
  status: UsageStatus;
  balanceAfter: number;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly defaultCost = 1;

  constructor(private readonly prisma: PrismaService) {}

  async checkCredits(user: SanitizedUser, cost: number = 1): Promise<boolean> {
    const userRecord = await this.prisma.user.findUnique({
      where: { authUserId: user.authUserId },
      select: { credits: true },
    });

    if (!userRecord) {
      throw new NotFoundException('User not found');
    }

    return userRecord.credits >= cost;
  }

  async recordGeneration(
    user: SanitizedUser,
    event: UsageEventInput,
  ): Promise<UsageEventResult> {
    const cost = this.normalizeCost(event.cost);

    return this.prisma.$transaction(async (tx) => {
      const userRecord = await tx.user.findUnique({
        where: { authUserId: user.authUserId },
        select: { credits: true },
      });

      if (!userRecord) {
        throw new NotFoundException('User not found for usage event');
      }

      const balanceAfter = userRecord.credits - cost;
      let status: UsageStatus = UsageStatus.COMPLETED;

      if (balanceAfter < 0) {
        throw new ForbiddenException(
          'Insufficient credits to complete generation. Each generation costs 1 credit.',
        );
      }

      await tx.user.update({
        where: { authUserId: user.authUserId },
        data: { credits: balanceAfter },
      });

      await tx.usageEvent.create({
        data: {
          userAuthId: user.authUserId,
          provider: event.provider,
          model: event.model ?? null,
          prompt: event.prompt ? event.prompt.slice(0, 4096) : null,
          cost,
          balanceAfter,
          status,
          metadata: event.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      return { status, balanceAfter };
    });
  }

  async listEvents(params: {
    userAuthId?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);

    const events = await this.prisma.usageEvent.findMany({
      where: params.userAuthId ? { userAuthId: params.userAuthId } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
    });

    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return {
      items: items.map((event) => ({
        id: event.id,
        userAuthId: event.userAuthId,
        provider: event.provider,
        model: event.model,
        prompt: event.prompt,
        cost: event.cost,
        balanceAfter: event.balanceAfter,
        status: event.status,
        metadata: event.metadata ?? null,
        createdAt: event.createdAt,
      })),
      nextCursor,
    };
  }

  private normalizeCost(input?: number): number {
    if (input === undefined || input === null) {
      return this.defaultCost;
    }
    if (!Number.isFinite(input)) {
      this.logger.warn(
        `Invalid cost value received: ${String(input)}. Falling back to default.`,
      );
      return this.defaultCost;
    }
    const rounded = Math.max(0, Math.round(input));
    return rounded;
  }
}
