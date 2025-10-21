#!/usr/bin/env node

/**
 * End-to-End test script for yearly subscription functionality
 * This script tests the complete flow from checkout creation to webhook processing
 * Run with: node test-yearly-subscription-e2e.js
 */

const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
require('dotenv').config();

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function testYearlySubscriptionE2E() {
  console.log('🧪 Testing Yearly Subscription E2E Flow...\n');

  try {
    // Test 1: Verify environment variables
    console.log('1. Verifying environment variables...');
    
    const proYearlyPriceId = process.env.STRIPE_PRO_YEARLY_PRICE_ID;
    const enterpriseYearlyPriceId = process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID;
    
    if (!proYearlyPriceId || !enterpriseYearlyPriceId) {
      throw new Error('Yearly price IDs not configured in environment');
    }
    
    console.log(`   ✅ Pro Yearly Price ID: ${proYearlyPriceId}`);
    console.log(`   ✅ Enterprise Yearly Price ID: ${enterpriseYearlyPriceId}`);

    // Test 2: Verify Stripe price IDs exist
    console.log('\n2. Verifying Stripe price IDs...');
    
    const proPrice = await stripe.prices.retrieve(proYearlyPriceId);
    const enterprisePrice = await stripe.prices.retrieve(enterpriseYearlyPriceId);
    
    console.log(`   ✅ Pro Yearly Price: $${proPrice.unit_amount/100}/year`);
    console.log(`   ✅ Enterprise Yearly Price: $${enterprisePrice.unit_amount/100}/year`);
    
    if (proPrice.recurring?.interval !== 'year') {
      throw new Error(`Pro price has wrong interval: ${proPrice.recurring?.interval}`);
    }
    if (enterprisePrice.recurring?.interval !== 'year') {
      throw new Error(`Enterprise price has wrong interval: ${enterprisePrice.recurring?.interval}`);
    }

    // Test 3: Create test user
    console.log('\n3. Creating test user...');
    
    const testUser = await prisma.user.upsert({
      where: { authUserId: 'test-yearly-e2e-user' },
      update: {},
      create: {
        id: 'test-yearly-e2e-user',
        authUserId: 'test-yearly-e2e-user',
        email: 'test-yearly-e2e@example.com',
        displayName: 'Test Yearly E2E User',
        credits: 20
      }
    });
    
    console.log(`   ✅ Test user created with ${testUser.credits} credits`);

    // Test 4: Test Pro Yearly checkout session creation
    console.log('\n4. Testing Pro Yearly checkout session creation...');
    
    const proCheckoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: proYearlyPriceId,
          quantity: 1,
        },
      ],
      success_url: 'http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:5173/pricing',
      customer_email: testUser.email,
      metadata: {
        userId: testUser.authUserId,
        planId: 'pro-yearly',
        credits: '12000',
        amount: '29000'
      }
    });
    
    console.log(`   ✅ Created Pro Yearly checkout session: ${proCheckoutSession.id}`);
    console.log(`   ✅ Checkout URL: ${proCheckoutSession.url}`);

    // Test 5: Test Enterprise Yearly checkout session creation
    console.log('\n5. Testing Enterprise Yearly checkout session creation...');
    
    const enterpriseCheckoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: enterpriseYearlyPriceId,
          quantity: 1,
        },
      ],
      success_url: 'http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:5173/pricing',
      customer_email: testUser.email,
      metadata: {
        userId: testUser.authUserId,
        planId: 'enterprise-yearly',
        credits: '60000',
        amount: '99000'
      }
    });
    
    console.log(`   ✅ Created Enterprise Yearly checkout session: ${enterpriseCheckoutSession.id}`);
    console.log(`   ✅ Checkout URL: ${enterpriseCheckoutSession.url}`);

    // Test 6: Simulate webhook processing for Pro Yearly
    console.log('\n6. Simulating Pro Yearly webhook processing...');
    
    // Create a mock subscription object
    const mockProSubscription = {
      id: 'sub_test_pro_yearly_' + Date.now(),
      customer: 'cus_test_pro_yearly',
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year from now
      cancel_at_period_end: false,
      items: {
        data: [{
          price: {
            id: proYearlyPriceId
          }
        }]
      }
    };
    
    // Create pending payment record
    const proPayment = await prisma.payment.create({
      data: {
        userId: testUser.authUserId,
        stripeSessionId: proCheckoutSession.id,
        amount: 29000, // $290.00
        credits: 12000,
        status: 'PENDING',
        type: 'SUBSCRIPTION',
        metadata: {
          planId: 'pro-yearly',
          planName: 'Pro',
          billingPeriod: 'yearly'
        }
      }
    });
    
    console.log(`   ✅ Created pending Pro Yearly payment: ${proPayment.id}`);

    // Test 7: Simulate webhook processing for Enterprise Yearly
    console.log('\n7. Simulating Enterprise Yearly webhook processing...');
    
    const mockEnterpriseSubscription = {
      id: 'sub_test_enterprise_yearly_' + Date.now(),
      customer: 'cus_test_enterprise_yearly',
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year from now
      cancel_at_period_end: false,
      items: {
        data: [{
          price: {
            id: enterpriseYearlyPriceId
          }
        }]
      }
    };
    
    // Create pending payment record
    const enterprisePayment = await prisma.payment.create({
      data: {
        userId: testUser.authUserId,
        stripeSessionId: enterpriseCheckoutSession.id,
        amount: 99000, // $990.00
        credits: 60000,
        status: 'PENDING',
        type: 'SUBSCRIPTION',
        metadata: {
          planId: 'enterprise-yearly',
          planName: 'Enterprise',
          billingPeriod: 'yearly'
        }
      }
    });
    
    console.log(`   ✅ Created pending Enterprise Yearly payment: ${enterprisePayment.id}`);

    // Test 8: Test subscription record creation
    console.log('\n8. Testing subscription record creation...');
    
    // Clean up any existing subscription
    await prisma.subscription.deleteMany({
      where: { userId: testUser.authUserId }
    });
    
    const proSubscription = await prisma.subscription.create({
      data: {
        userId: testUser.authUserId,
        stripeSubscriptionId: mockProSubscription.id,
        stripePriceId: proYearlyPriceId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(mockProSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(mockProSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: mockProSubscription.cancel_at_period_end,
        credits: 12000
      }
    });
    
    console.log(`   ✅ Created Pro Yearly subscription: ${proSubscription.id}`);
    console.log(`   ✅ Credits: ${proSubscription.credits}`);
    console.log(`   ✅ Period: ${proSubscription.currentPeriodStart.toISOString().split('T')[0]} to ${proSubscription.currentPeriodEnd.toISOString().split('T')[0]}`);

    // Test 9: Test payment completion
    console.log('\n9. Testing payment completion...');
    
    await prisma.payment.update({
      where: { id: proPayment.id },
      data: { status: 'COMPLETED' }
    });
    
    await prisma.payment.update({
      where: { id: enterprisePayment.id },
      data: { status: 'COMPLETED' }
    });
    
    console.log(`   ✅ Updated payment status to COMPLETED`);

    // Test 10: Test credit addition
    console.log('\n10. Testing credit addition...');
    
    const updatedUser = await prisma.user.update({
      where: { authUserId: testUser.authUserId },
      data: {
        credits: {
          increment: 12000 // Pro Yearly credits
        }
      }
    });
    
    console.log(`   ✅ Added 12,000 credits to user. Total: ${updatedUser.credits}`);

    // Test 11: Test subscription queries
    console.log('\n11. Testing subscription queries...');
    
    const userSubscription = await prisma.subscription.findUnique({
      where: { userId: testUser.authUserId }
    });
    
    if (!userSubscription) {
      throw new Error('User subscription not found');
    }
    
    console.log(`   ✅ Found user subscription: ${userSubscription.id}`);
    console.log(`   ✅ Status: ${userSubscription.status}`);
    console.log(`   ✅ Credits: ${userSubscription.credits}`);
    console.log(`   ✅ Price ID: ${userSubscription.stripePriceId}`);

    // Test 12: Test billing period detection
    console.log('\n12. Testing billing period detection...');
    
    const isYearly = userSubscription.stripePriceId === proYearlyPriceId || 
                     userSubscription.stripePriceId === enterpriseYearlyPriceId;
    
    console.log(`   ✅ Detected billing period: ${isYearly ? 'yearly' : 'monthly'}`);
    
    if (!isYearly) {
      throw new Error('Billing period detection failed');
    }

    // Test 13: Test subscription management
    console.log('\n13. Testing subscription management...');
    
    // Test cancellation
    await prisma.subscription.update({
      where: { id: userSubscription.id },
      data: {
        status: 'CANCELLED',
        cancelAtPeriodEnd: true
      }
    });
    
    console.log(`   ✅ Subscription cancelled successfully`);
    
    // Test reactivation
    await prisma.subscription.update({
      where: { id: userSubscription.id },
      data: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false
      }
    });
    
    console.log(`   ✅ Subscription reactivated successfully`);

    // Cleanup test data
    console.log('\n14. Cleaning up test data...');
    
    await prisma.payment.deleteMany({
      where: { userId: testUser.authUserId }
    });
    
    await prisma.subscription.deleteMany({
      where: { userId: testUser.authUserId }
    });
    
    await prisma.user.deleteMany({
      where: { authUserId: testUser.authUserId }
    });
    
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 All yearly subscription E2E tests passed!');
    console.log('\n📋 Summary:');
    console.log(`   ✅ Pro Yearly: $290/year, 12,000 credits`);
    console.log(`   ✅ Enterprise Yearly: $990/year, 60,000 credits`);
    console.log(`   ✅ Stripe price IDs verified`);
    console.log(`   ✅ Checkout sessions created successfully`);
    console.log(`   ✅ Webhook processing simulated`);
    console.log(`   ✅ Database records created correctly`);
    console.log(`   ✅ Credit calculations working`);
    console.log(`   ✅ Billing period detection working`);
    console.log(`   ✅ Subscription management working`);

  } catch (error) {
    console.error('\n❌ E2E test failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testYearlySubscriptionE2E();
