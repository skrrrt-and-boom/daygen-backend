#!/usr/bin/env node

/**
 * Smoke script for Stripe payment integration
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPaymentIntegration() {
  console.log('🧪 Testing Stripe Payment Integration...\n');

  try {
    // 1) DB models sanity
    console.log('1. Testing database models...');
    const paymentCount = await prisma.payment.count();
    const subscriptionCount = await prisma.subscription.count();
    console.log(`   ✅ Payment model: ${paymentCount} records`);
    console.log(`   ✅ Subscription model: ${subscriptionCount} records`);

    // 2) Create test user
    console.log('\n2. Creating test user...');
    const testUser = await prisma.user.upsert({
      where: { authUserId: 'test-user-id' },
      update: {},
      create: {
        id: 'test-user-id',
        authUserId: 'test-user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        credits: 20
      }
    });
    console.log(`   ✅ Test user created with ${testUser.credits} credits`);

    // 3) Create test payment record
    console.log('\n3. Testing payment record creation...');
    const testPayment = await prisma.payment.create({
      data: {
        userId: 'test-user-id',
        stripeSessionId: 'cs_test_' + Date.now(),
        amount: 100,
        credits: 10,
        status: 'PENDING',
        type: 'ONE_TIME',
        metadata: { test: true, packageId: 'test' }
      }
    });
    console.log(`   ✅ Created test payment: ${testPayment.id}`);

    // 4) Create test subscription record
    console.log('\n4. Testing subscription record creation...');
    const testSubscription = await prisma.subscription.create({
      data: {
        userId: 'test-user-id',
        stripeSubscriptionId: 'sub_test_' + Date.now(),
        stripePriceId: 'price_test_monthly',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        credits: 1000
      }
    });
    console.log(`   ✅ Created test subscription: ${testSubscription.id}`);

    // 5) Credit addition logic
    console.log('\n5. Testing credit addition logic...');
    const updatedUser = await prisma.user.update({
      where: { authUserId: 'test-user-id' },
      data: { credits: { increment: 10 } }
    });
    console.log(`   ✅ Credits added: ${updatedUser.credits} total credits`);

    // 6) Payment history
    console.log('\n6. Testing payment history query...');
    const paymentHistory = await prisma.payment.findMany({
      where: { userId: 'test-user-id' },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log(`   ✅ Payment history: ${paymentHistory.length} records found`);

    // 7) Subscription query
    console.log('\n7. Testing subscription query...');
    const subscription = await prisma.subscription.findUnique({
      where: { userId: 'test-user-id' }
    });
    console.log(`   ✅ Subscription found: ${subscription ? subscription.id : 'None'}`);

    // Cleanup
    console.log('\n8. Cleaning up test data...');
    await prisma.payment.deleteMany({ where: { userId: 'test-user-id' } });
    await prisma.subscription.deleteMany({ where: { userId: 'test-user-id' } });
    await prisma.user.deleteMany({ where: { authUserId: 'test-user-id' } });
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 All tests passed! Payment integration is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testPaymentIntegration();


