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

    const graceCredits = this.getGraceCredits();
    const projected = userRecord.credits - cost;
    return projected >= -graceCredits;
  }

  async recordGeneration(
    user: SanitizedUser,
    event: UsageEventInput,
  ): Promise<UsageEventResult> {
    const cost = this.normalizeCost(event.cost);
    const sanitizedMetadata = this.sanitizeMetadata(event.metadata);

    // Apply atomic debit via SQL function; it enforces grace based on plan
    try {
      const newBalanceRows = await this.prisma.$queryRawUnsafe<
        { apply_credit_delta: number }[]
      >(
        'SELECT public.apply_credit_delta($1, $2, $3::"CreditReason", $4::"CreditSourceType", $5, $6, $7, $8, $9::jsonb) as apply_credit_delta',
        user.authUserId,
        -cost,
        'JOB',
        'JOB',
        null,
        event.provider,
        event.model ?? null,
        null,
        JSON.stringify({
          prompt: event.prompt?.slice(0, 256),
          ...sanitizedMetadata,
        }),
      );
      const balanceAfter = newBalanceRows?.[0]?.apply_credit_delta ?? 0;

      // Write a lightweight usage event for audit and pagination
      await this.prisma.usageEvent.create({
        data: {
          userAuthId: user.authUserId,
          provider: event.provider,
          model: event.model ?? null,
          prompt: event.prompt ? event.prompt.slice(0, 4096) : null,
          cost,
          balanceAfter,
          status: balanceAfter < 0 ? UsageStatus.GRACE : UsageStatus.COMPLETED,
          metadata: sanitizedMetadata as Prisma.InputJsonValue | undefined,
        },
      });

      return {
        status: balanceAfter < 0 ? UsageStatus.GRACE : UsageStatus.COMPLETED,
        balanceAfter,
      };
    } catch (e) {
      if (e instanceof Error && /Insufficient credits/.test(e.message)) {
        throw new ForbiddenException(
          'Insufficient credits to complete generation.',
        );
      }
      throw e;
    }
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

  private getGraceCredits(): number {
    const graceCredits = process.env.USAGE_GRACE_CREDITS;
    if (graceCredits === undefined) {
      return 0;
    }
    const parsed = parseInt(graceCredits, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
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

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
    maxSizeBytes: number = 8192,
  ): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }

    const redactIfBase64 = (value: unknown): unknown => {
      if (typeof value === 'string') {
        if (/^data:[^;]+;base64,/i.test(value)) {
          return '[redacted-data-url]';
        }
        if (value.length > maxSizeBytes) {
          return `${value.slice(0, Math.min(2048, maxSizeBytes))}...[truncated]`;
        }
      } else if (Array.isArray(value)) {
        return value.slice(0, 50).map((v) => redactIfBase64(v));
      } else if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        let count = 0;
        for (const [k, v] of Object.entries(obj)) {
          if (count++ > 50) {
            out['__truncated__'] = true;
            break;
          }
          out[k] = redactIfBase64(v);
        }
        return out;
      }
      return value;
    };

    const cleaned = redactIfBase64(metadata) as Record<string, unknown>;
    try {
      const serialized = JSON.stringify(cleaned);
      if (serialized.length > maxSizeBytes) {
        return {
          note: 'metadata-truncated',
          preview: serialized.slice(0, maxSizeBytes),
        };
      }
    } catch {
      return { note: 'metadata-unserializable' };
    }
    return cleaned;
  }
}
