import { ForbiddenException } from '@nestjs/common';
import { UsageStatus } from '@prisma/client';
import { UsageService } from './usage.service';
import { PrismaService } from '../prisma/prisma.service';

const createService = (credits: number, grace = 0) => {
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ credits }),
      update: jest.fn().mockResolvedValue(null),
    },
    usageEvent: {
      create: jest.fn().mockResolvedValue(null),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (txArg: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  } as unknown as PrismaService;

  if (grace !== undefined) {
    process.env.USAGE_GRACE_CREDITS = grace.toString();
  } else {
    delete process.env.USAGE_GRACE_CREDITS;
  }

  const service = new UsageService(prisma);
  return { service, tx };
};

describe('UsageService', () => {
  afterEach(() => {
    delete process.env.USAGE_GRACE_CREDITS;
  });

  it('deducts credits and records event for successful generation', async () => {
    const { service, tx } = createService(10);

    const result = await service.recordGeneration(
      {
        id: 'user-id',
        authUserId: 'auth-id',
        email: 'user@example.com',
        displayName: null,
        credits: 10,
        profileImage: null,
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        provider: 'test-provider',
        model: 'test-model',
        prompt: 'prompt',
        cost: 2,
      },
    );

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { authUserId: 'auth-id' },
      data: { credits: 8 },
    });
    expect(tx.usageEvent.create).toHaveBeenCalledTimes(1);
    const usageCreateMock = tx.usageEvent.create as jest.Mock<
      Promise<unknown>,
      [Record<string, unknown>]
    >;
    const usagePayloadRaw: unknown = usageCreateMock.mock.calls[0]?.[0];
    expect(usagePayloadRaw).toBeDefined();
    const usagePayload = usagePayloadRaw as Record<string, unknown>;
    expect(usagePayload).toMatchObject({
      data: {
        provider: 'test-provider',
        model: 'test-model',
        cost: 2,
        balanceAfter: 8,
        status: UsageStatus.COMPLETED,
      },
    });
    expect(result).toEqual({ status: UsageStatus.COMPLETED, balanceAfter: 8 });
  });

  it('allows grace usage when within limit', async () => {
    const { service, tx } = createService(0, 5);

    const result = await service.recordGeneration(
      {
        id: 'user-id',
        authUserId: 'auth-id',
        email: 'user@example.com',
        displayName: null,
        credits: 0,
        profileImage: null,
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        provider: 'test-provider',
        cost: 3,
      },
    );

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { authUserId: 'auth-id' },
      data: { credits: -3 },
    });
    expect(tx.usageEvent.create).toHaveBeenCalledTimes(1);
    const graceCreateMock = tx.usageEvent.create as jest.Mock<
      Promise<unknown>,
      [Record<string, unknown>]
    >;
    const gracePayloadRaw: unknown = graceCreateMock.mock.calls[0]?.[0];
    expect(gracePayloadRaw).toBeDefined();
    const gracePayload = gracePayloadRaw as Record<string, unknown>;
    expect(gracePayload).toMatchObject({
      data: {
        balanceAfter: -3,
        status: UsageStatus.GRACE,
      },
    });
    expect(result).toEqual({ status: UsageStatus.GRACE, balanceAfter: -3 });
  });

  it('throws when exceeding grace limit', async () => {
    const { service } = createService(1, 1);

    await expect(
      service.recordGeneration(
        {
          id: 'user-id',
          authUserId: 'auth-id',
          email: 'user@example.com',
          displayName: null,
          credits: 1,
          profileImage: null,
          role: 'USER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          provider: 'test-provider',
          cost: 5,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
