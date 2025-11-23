import { ForbiddenException } from '@nestjs/common';
import { UsageStatus } from '@prisma/client';
import { UsageService } from './usage.service';
import { PrismaService } from '../prisma/prisma.service';

const createService = (credits: number, grace = 0) => {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ credits }),
      update: jest.fn().mockResolvedValue({}),
    },
    usageEvent: {
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation((sql: string, _userId: string, delta: number) => {
        const newBalance = credits + (typeof delta === 'number' ? delta : 0);
        return Promise.resolve([{ apply_credit_delta: newBalance }]);
      }),
  } as unknown as PrismaService;

  if (grace !== undefined) {
    process.env.USAGE_GRACE_CREDITS = grace.toString();
  } else {
    delete process.env.USAGE_GRACE_CREDITS;
  }

  const service = new UsageService(prisma);
  return { service, prisma } as unknown as {
    service: UsageService;
    prisma: any;
  };
};

describe('UsageService', () => {
  afterEach(() => {
    delete process.env.USAGE_GRACE_CREDITS;
  });

  it('deducts credits and records event for successful generation', async () => {
    const { service, prisma } = createService(10);

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

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.usageEvent.create).toHaveBeenCalledTimes(1);
    const usageCreateMock = prisma.usageEvent.create as jest.Mock<
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
    const { service, prisma } = createService(0, 5);
    // Mock apply_credit_delta to return -3
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
      { apply_credit_delta: -3 },
    ]);

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

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.usageEvent.create).toHaveBeenCalledTimes(1);
    const graceCreateMock = prisma.usageEvent.create as jest.Mock<
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
    const { service, prisma } = createService(1, 1);
    // Simulate apply_credit_delta raising error
    (prisma.$queryRawUnsafe as jest.Mock).mockRejectedValueOnce(
      new Error('Insufficient credits to apply delta'),
    );

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


  describe('transactional flow', () => {
    it('reserves credits correctly', async () => {
      const { service, prisma } = createService(10);
      (prisma.usageEvent.create as jest.Mock).mockResolvedValue({ id: 'res-1' });

      const result = await service.reserveCredits(
        { authUserId: 'auth-id' } as any,
        { provider: 'test', cost: 2 },
      );

      expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
      expect(prisma.usageEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UsageStatus.RESERVED,
            cost: 2,
          }),
        }),
      );
      expect(result).toEqual({ reservationId: 'res-1', balanceAfter: 8 });
    });

    it('captures credits correctly', async () => {
      const { service, prisma } = createService(10);

      await service.captureCredits('res-1', { final: true });

      expect(prisma.usageEvent.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: {
          status: UsageStatus.COMPLETED,
          metadata: expect.objectContaining({ final: true }),
        },
      });
    });

    it('releases credits correctly', async () => {
      const { service, prisma } = createService(10);
      (prisma.usageEvent.findUnique as jest.Mock).mockResolvedValue({
        id: 'res-1',
        status: UsageStatus.RESERVED,
        userAuthId: 'auth-id',
        cost: 2,
        metadata: {},
      });

      await service.releaseCredits('res-1', 'error');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { authUserId: 'auth-id' },
        data: { credits: { increment: 2 } },
      });
      expect(prisma.usageEvent.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: {
          status: UsageStatus.CANCELLED,
          metadata: expect.objectContaining({ cancellationReason: 'error' }),
        },
      });
    });
  });
});
