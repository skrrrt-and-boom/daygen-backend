#!/usr/bin/env node
/**
 * Validate Subscription.stripePriceId values map to known plans before migration/deployment.
 * - Reads distinct price IDs from DB
 * - Compares to env-configured IDs (and optional aliases)
 * - Prints a report and non-zero exit if unknown IDs found (when STRICT=true)
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function buildKnownPriceIdSet() {
  const known = new Set([
    process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_ENTERPRISE_PRICE_ID,
    process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID,
  ].filter(Boolean));

  // Optional legacy aliases/placeholders encountered historically
  const aliases = [
    'price_pro',
    'price_enterprise',
    'price_pro_yearly',
    'price_enterprise_yearly',
    'pro',
    'enterprise',
    'pro-yearly',
    'enterprise-yearly',
  ];
  aliases.forEach((a) => known.add(a));
  return known;
}

async function main() {
  const known = buildKnownPriceIdSet();
  const strict = /^true$/i.test(process.env.STRICT || 'false');

  console.log('🔎 Validating Subscription.stripePriceId values...');
  const rows = await prisma.subscription.findMany({
    select: { stripePriceId: true },
    distinct: ['stripePriceId'],
  });

  const priceIds = rows.map((r) => r.stripePriceId).filter(Boolean);
  console.log(`Found ${priceIds.length} distinct price IDs in database.`);

  const unknown = priceIds.filter((id) => !known.has(id));

  if (unknown.length === 0) {
    console.log('✅ All subscription price IDs map to known plans.');
  } else {
    console.log('⚠️ Unknown subscription price IDs found:');
    unknown.forEach((id) => console.log(` - ${id}`));
    console.log('Set STRIPE_*_PRICE_ID env vars appropriately or add aliases.');
    if (strict) {
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('💥 Validation error:', err);
  await prisma.$disconnect();
  process.exit(2);
});


