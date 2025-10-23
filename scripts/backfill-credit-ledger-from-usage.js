#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function mapReason(provider, model) {
  if (provider === 'stripe' && model === 'payment') return 'PAYMENT';
  if (provider === 'system' && model === 'refund') return 'REFUND';
  return 'JOB';
}

function mapSourceType(provider, model) {
  if (provider === 'stripe' && model === 'payment') return 'PAYMENT';
  if (provider === 'system' && model === 'refund') return 'SYSTEM';
  return 'JOB';
}

async function backfill({ apply = false, limit = 1000 }) {
  console.log(`Starting backfill (apply=${apply})...`);
  let lastId = null;
  let totalProcessed = 0;
  let totalInserted = 0;

  while (true) {
    const batch = await prisma.usageEvent.findMany({
      where: lastId ? { id: { gt: lastId } } : undefined,
      orderBy: [{ id: 'asc' }],
      take: limit,
    });
    if (batch.length === 0) break;

    for (const ev of batch) {
      totalProcessed++;
      lastId = ev.id;
      const delta = -ev.cost; // positive for credits, negative for debits
      const reason = mapReason(ev.provider, ev.model);
      const sourceType = mapSourceType(ev.provider, ev.model);
      const sourceId = ev.metadata && ev.metadata.paymentId ? String(ev.metadata.paymentId) : null;

      // Check idempotency by metadata marker
      const existing = await prisma.creditLedger.findFirst({
        where: {
          userId: ev.userAuthId,
          metadata: { path: ['migratedFromUsageEventId'], equals: ev.id },
        },
        select: { id: true },
      });
      if (existing) continue;

      if (apply) {
        await prisma.creditLedger.create({
          data: {
            userId: ev.userAuthId,
            delta,
            balanceAfter: ev.balanceAfter,
            reason,
            sourceType,
            sourceId,
            provider: ev.provider,
            model: ev.model || undefined,
            promptHash: undefined,
            metadata: {
              migratedFromUsageEventId: ev.id,
              migratedAt: new Date().toISOString(),
            },
            createdAt: ev.createdAt,
          },
        });
        totalInserted++;
      }
    }

    console.log(`Processed ${totalProcessed} usage events... inserted ${totalInserted}`);
  }

  // Optional: verify balances
  const sampleUsers = await prisma.user.findMany({ select: { authUserId: true, credits: true }, take: 50 });
  for (const u of sampleUsers) {
    const agg = await prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { userId: u.authUserId },
    });
    const sum = agg._sum.delta || 0;
    if (sum !== u.credits) {
      console.warn(`User ${u.authUserId} balance mismatch: ledger=${sum} user=${u.credits}`);
    }
  }

  console.log(`Backfill complete. processed=${totalProcessed} inserted=${totalInserted}`);
}

const APPLY = process.env.APPLY === 'true' || process.argv.includes('--apply');
const LIMIT = Number(process.env.LIMIT || 1000);

backfill({ apply: APPLY, limit: LIMIT })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


