#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

// Local copy to avoid importing TS in a Node script
const SUBSCRIPTION_PLANS = [
  { id: 'pro', name: 'Pro', credits: 1000, price: 2900, interval: 'month' },
  { id: 'enterprise', name: 'Enterprise', credits: 5000, price: 9900, interval: 'month' },
  { id: 'pro-yearly', name: 'Pro', credits: 12000, price: 29000, interval: 'year' },
  { id: 'enterprise-yearly', name: 'Enterprise', credits: 60000, price: 99000, interval: 'year' },
];

const prisma = new PrismaClient();

function getPriceIdForPlan(planId) {
  const map = {
    // Monthly
    pro: process.env.STRIPE_PRO_PRICE_ID || '',
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
    // Yearly
    'pro-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
    'enterprise-yearly': process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '',
  };
  return map[planId] || '';
}

function toInterval(interval) {
  return interval === 'year' ? 'yearly' : 'monthly';
}

async function main() {
  console.log('Seeding Plan table from SUBSCRIPTION_PLANS...');
  for (const p of SUBSCRIPTION_PLANS) {
    const stripePriceId = getPriceIdForPlan(p.id);
    if (!stripePriceId) {
      console.warn(`Skipping plan ${p.id} - missing stripe price id env var`);
      continue;
    }
    await prisma.plan.upsert({
      where: { stripePriceId },
      update: {
        code: p.id,
        name: p.name,
        interval: toInterval(p.interval),
        creditsPerPeriod: p.credits,
        active: true,
      },
      create: {
        code: p.id,
        name: p.name,
        interval: toInterval(p.interval),
        creditsPerPeriod: p.credits,
        graceCredits: 0,
        stripePriceId,
        active: true,
      },
    });
    console.log(`Upserted plan ${p.id} (${stripePriceId})`);
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


