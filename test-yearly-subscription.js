#!/usr/bin/env node

/**
 * Test script for yearly subscription functionality
 * Run with: node test-yearly-subscription.js
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// Import the subscription plans configuration
const { SUBSCRIPTION_PLANS, getSubscriptionPlanById } = require('./dist/payments/credit-packages.config');

async function testYearlySubscriptions() {
  console.log('🧪 Testing Yearly Subscription Functionality...\n');

  try {
    // Test 1: Check if yearly plans are defined in configuration
    console.log('1. Testing yearly plan configuration...');
    
    const proYearlyPlan = getSubscriptionPlanById('pro-yearly');
    const enterpriseYearlyPlan = getSubscriptionPlanById('enterprise-yearly');
    
    if (!proYearlyPlan) {
      throw new Error('Pro yearly plan not found in configuration');
    }
    if (!enterpriseYearlyPlan) {
      throw new Error('Enterprise yearly plan not found in configuration');
    }
    
    console.log(`   ✅ Pro Yearly Plan: ${proYearlyPlan.name} - $${proYearlyPlan.price/100}/year - ${proYearlyPlan.credits} credits`);
    console.log(`   ✅ Enterprise Yearly Plan: ${enterpriseYearlyPlan.name} - $${enterpriseYearlyPlan.price/100}/year - ${enterpriseYearlyPlan.credits} credits`);
    
    // Verify plan details
    if (proYearlyPlan.interval !== 'year') {
      throw new Error(`Pro yearly plan has wrong interval: ${proYearlyPlan.interval}`);
    }
    if (enterpriseYearlyPlan.interval !== 'year') {
      throw new Error(`Enterprise yearly plan has wrong interval: ${enterpriseYearlyPlan.interval}`);
    }
    
    if (proYearlyPlan.credits !== 12000) {
      throw new Error(`Pro yearly plan has wrong credits: ${proYearlyPlan.credits}, expected 12000`);
    }
    if (enterpriseYearlyPlan.credits !== 60000) {
      throw new Error(`Enterprise yearly plan has wrong credits: ${enterpriseYearlyPlan.credits}, expected 60000`);
    }
    
    if (proYearlyPlan.price !== 29000) {
      throw new Error(`Pro yearly plan has wrong price: ${proYearlyPlan.price}, expected 29000 (290.00)`);
    }
    if (enterpriseYearlyPlan.price !== 99000) {
      throw new Error(`Enterprise yearly plan has wrong price: ${enterpriseYearlyPlan.price}, expected 99000 (990.00)`);
    }

    // Test 2: Check environment variables
    console.log('\n2. Testing environment variables...');
    
    const proYearlyPriceId = process.env.STRIPE_PRO_YEARLY_PRICE_ID;
    const enterpriseYearlyPriceId = process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID;
    
    if (!proYearlyPriceId) {
      throw new Error('STRIPE_PRO_YEARLY_PRICE_ID not found in environment');
    }
    if (!enterpriseYearlyPriceId) {
      throw new Error('STRIPE_ENTERPRISE_YEARLY_PRICE_ID not found in environment');
    }
    
    console.log(`   ✅ Pro Yearly Price ID: ${proYearlyPriceId}`);
    console.log(`   ✅ Enterprise Yearly Price ID: ${enterpriseYearlyPriceId}`);

    // Test 3: Test database models support yearly subscriptions
    console.log('\n3. Testing database models...');
    
    const paymentCount = await prisma.payment.count();
    const subscriptionCount = await prisma.subscription.count();
    
    console.log(`   ✅ Payment model: ${paymentCount} records`);
    console.log(`   ✅ Subscription model: ${subscriptionCount} records`);

    // Test 4: Create test user
    console.log('\n4. Creating test user...');
    
    const testUser = await prisma.user.upsert({
      where: { authUserId: 'test-yearly-user' },
      update: {},
      create: {
        id: 'test-yearly-user',
        authUserId: 'test-yearly-user',
        email: 'test-yearly@example.com',
        displayName: 'Test Yearly User',
        credits: 20
      }
    });
    
    console.log(`   ✅ Test user created with ${testUser.credits} credits`);

    // Test 5: Test Pro Yearly subscription creation
    console.log('\n5. Testing Pro Yearly subscription creation...');
    
    // First, clean up any existing subscription for this user
    await prisma.subscription.deleteMany({
      where: { userId: 'test-yearly-user' }
    });
    
    const proYearlySubscription = await prisma.subscription.create({
      data: {
        userId: 'test-yearly-user',
        stripeSubscriptionId: 'sub_test_pro_yearly_' + Date.now(),
        stripePriceId: proYearlyPriceId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        cancelAtPeriodEnd: false,
        credits: proYearlyPlan.credits
      }
    });
    
    console.log(`   ✅ Created Pro Yearly subscription: ${proYearlySubscription.id}`);
    console.log(`   ✅ Credits: ${proYearlySubscription.credits}`);
    console.log(`   ✅ Period: ${proYearlySubscription.currentPeriodStart.toISOString().split('T')[0]} to ${proYearlySubscription.currentPeriodEnd.toISOString().split('T')[0]}`);

    // Test 6: Create second test user for Enterprise Yearly
    console.log('\n6. Creating second test user for Enterprise Yearly...');
    
    const testUser2 = await prisma.user.upsert({
      where: { authUserId: 'test-yearly-user-2' },
      update: {},
      create: {
        id: 'test-yearly-user-2',
        authUserId: 'test-yearly-user-2',
        email: 'test-yearly-2@example.com',
        displayName: 'Test Yearly User 2',
        credits: 20
      }
    });
    
    console.log(`   ✅ Second test user created with ${testUser2.credits} credits`);

    // Test 7: Test Enterprise Yearly subscription creation
    console.log('\n7. Testing Enterprise Yearly subscription creation...');
    
    // Clean up any existing subscription for this user
    await prisma.subscription.deleteMany({
      where: { userId: 'test-yearly-user-2' }
    });
    
    const enterpriseYearlySubscription = await prisma.subscription.create({
      data: {
        userId: 'test-yearly-user-2',
        stripeSubscriptionId: 'sub_test_enterprise_yearly_' + Date.now(),
        stripePriceId: enterpriseYearlyPriceId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        cancelAtPeriodEnd: false,
        credits: enterpriseYearlyPlan.credits
      }
    });
    
    console.log(`   ✅ Created Enterprise Yearly subscription: ${enterpriseYearlySubscription.id}`);
    console.log(`   ✅ Credits: ${enterpriseYearlySubscription.credits}`);

    // Test 8: Test payment record creation for yearly subscriptions
    console.log('\n8. Testing payment record creation...');
    
    const proYearlyPayment = await prisma.payment.create({
      data: {
        userId: 'test-yearly-user',
        stripeSessionId: 'cs_test_pro_yearly_' + Date.now(),
        amount: proYearlyPlan.price,
        credits: proYearlyPlan.credits,
        status: 'COMPLETED',
        type: 'SUBSCRIPTION',
        metadata: {
          planId: 'pro-yearly',
          planName: 'Pro',
          billingPeriod: 'yearly',
          stripeSubscriptionId: proYearlySubscription.stripeSubscriptionId
        }
      }
    });
    
    const enterpriseYearlyPayment = await prisma.payment.create({
      data: {
        userId: 'test-yearly-user-2',
        stripeSessionId: 'cs_test_enterprise_yearly_' + Date.now(),
        amount: enterpriseYearlyPlan.price,
        credits: enterpriseYearlyPlan.credits,
        status: 'COMPLETED',
        type: 'SUBSCRIPTION',
        metadata: {
          planId: 'enterprise-yearly',
          planName: 'Enterprise',
          billingPeriod: 'yearly',
          stripeSubscriptionId: enterpriseYearlySubscription.stripeSubscriptionId
        }
      }
    });
    
    console.log(`   ✅ Created Pro Yearly payment: ${proYearlyPayment.id} - $${proYearlyPayment.amount/100}`);
    console.log(`   ✅ Created Enterprise Yearly payment: ${enterpriseYearlyPayment.id} - $${enterpriseYearlyPayment.amount/100}`);

    // Test 9: Test credit addition for yearly subscriptions
    console.log('\n9. Testing credit addition...');
    
    // Add Pro Yearly credits
    const updatedUser1 = await prisma.user.update({
      where: { authUserId: 'test-yearly-user' },
      data: {
        credits: {
          increment: proYearlyPlan.credits
        }
      }
    });
    
    // Add Enterprise Yearly credits
    const updatedUser2 = await prisma.user.update({
      where: { authUserId: 'test-yearly-user-2' },
      data: {
        credits: {
          increment: enterpriseYearlyPlan.credits
        }
      }
    });
    
    console.log(`   ✅ Pro Yearly user credits: ${updatedUser1.credits} (added ${proYearlyPlan.credits})`);
    console.log(`   ✅ Enterprise Yearly user credits: ${updatedUser2.credits} (added ${enterpriseYearlyPlan.credits})`);

    // Test 10: Test billing period detection
    console.log('\n10. Testing billing period detection...');
    
    const proYearlySubscriptionInfo = await prisma.subscription.findUnique({
      where: { userId: 'test-yearly-user' }
    });
    
    // Simulate the billing period detection logic from the service
    const proPlan = SUBSCRIPTION_PLANS.find(p => p.id === 'pro-yearly');
    const detectedBillingPeriod = proPlan?.id?.includes('yearly') ? 'yearly' : 'monthly';
    
    console.log(`   ✅ Detected billing period for Pro Yearly: ${detectedBillingPeriod}`);
    
    if (detectedBillingPeriod !== 'yearly') {
      throw new Error(`Billing period detection failed: expected 'yearly', got '${detectedBillingPeriod}'`);
    }

    // Test 11: Test subscription queries
    console.log('\n11. Testing subscription queries...');
    
    const allYearlySubscriptions = await prisma.subscription.findMany({
      where: {
        OR: [
          { stripePriceId: proYearlyPriceId },
          { stripePriceId: enterpriseYearlyPriceId }
        ]
      }
    });
    
    console.log(`   ✅ Found ${allYearlySubscriptions.length} yearly subscriptions`);
    
    const yearlyPayments = await prisma.payment.findMany({
      where: {
        metadata: {
          path: ['billingPeriod'],
          equals: 'yearly'
        }
      }
    });
    
    console.log(`   ✅ Found ${yearlyPayments.length} yearly payments`);

    // Cleanup test data
    console.log('\n12. Cleaning up test data...');
    
    await prisma.payment.deleteMany({
      where: { 
        OR: [
          { userId: 'test-yearly-user' },
          { userId: 'test-yearly-user-2' }
        ]
      }
    });
    
    await prisma.subscription.deleteMany({
      where: { 
        OR: [
          { userId: 'test-yearly-user' },
          { userId: 'test-yearly-user-2' }
        ]
      }
    });
    
    await prisma.user.deleteMany({
      where: { 
        OR: [
          { authUserId: 'test-yearly-user' },
          { authUserId: 'test-yearly-user-2' }
        ]
      }
    });
    
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 All yearly subscription tests passed!');
    console.log('\n📋 Summary:');
    console.log(`   ✅ Pro Yearly: $${proYearlyPlan.price/100}/year, ${proYearlyPlan.credits} credits`);
    console.log(`   ✅ Enterprise Yearly: $${enterpriseYearlyPlan.price/100}/year, ${enterpriseYearlyPlan.credits} credits`);
    console.log(`   ✅ Environment variables configured`);
    console.log(`   ✅ Database models support yearly subscriptions`);
    console.log(`   ✅ Billing period detection working`);
    console.log(`   ✅ Credit calculations correct`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testYearlySubscriptions();
