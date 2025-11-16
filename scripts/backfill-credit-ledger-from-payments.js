#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function backfill({ apply = false, batchSize = 500 }) {
  console.log(`Backfilling CreditLedger from Payment (apply=${apply})...`);
  let lastId = null;
  let processed = 0;
  let inserted = 0;

  while (true) {
    const payments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: [{ id: 'asc' }],
      take: batchSize,
      ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}),
    });
    if (!payments.length) break;

    for (const p of payments) {
      processed++;
      lastId = p.id;

      // Check existing ledger record linked to this payment
      const existing = await prisma.creditLedger.findFirst({
        where: {
          userId: p.userId,
          sourceType: 'PAYMENT',
          sourceId: p.id,
        },
        select: { id: true },
      });
      if (existing) continue;

      if (apply) {
        await prisma.creditLedger.create({
          data: {
            userId: p.userId,
            delta: p.credits,
            balanceAfter: 0, // unknown historical precise balance; can be recomputed later
            reason: 'PAYMENT',
            sourceType: 'PAYMENT',
            sourceId: p.id,
            provider: 'stripe',
            model: 'payment',
            metadata: {
              migratedFromPaymentId: p.id,
              stripeSessionId: p.stripeSessionId,
              stripePaymentIntentId: p.stripePaymentIntentId,
            },
            createdAt: p.createdAt,
          },
        });
        inserted++;
      }
    }

    console.log(`Processed=${processed} Inserted=${inserted}`);
  }

  // Verification sample
  const sample = await prisma.user.findMany({ select: { authUserId: true, credits: true }, take: 50 });
  for (const u of sample) {
    const agg = await prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { userId: u.authUserId },
    });
    const sum = agg._sum.delta || 0;
    if (sum !== u.credits) {
      console.warn(`Mismatch for user ${u.authUserId}: ledger=${sum} user=${u.credits}`);
    }
  }

  console.log('Backfill from payments complete.');
}

const APPLY = process.env.APPLY === 'true' || process.argv.includes('--apply');
const BATCH = Number(process.env.BATCH || 500);

backfill({ apply: APPLY, batchSize: BATCH })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


