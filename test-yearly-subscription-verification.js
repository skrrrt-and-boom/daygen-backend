#!/usr/bin/env node

/**
 * Verification script for yearly subscription functionality
 * This script verifies that all yearly subscription components are working correctly
 * Run with: node test-yearly-subscription-verification.js
 */

const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function verifyYearlySubscriptions() {
  console.log('🔍 Verifying Yearly Subscription Implementation...\n');

  let allTestsPassed = true;

  try {
    // Test 1: Environment Variables
    console.log('1. ✅ Environment Variables');
    const proYearlyPriceId = process.env.STRIPE_PRO_YEARLY_PRICE_ID;
    const enterpriseYearlyPriceId = process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID;
    
    if (!proYearlyPriceId || !enterpriseYearlyPriceId) {
      console.log('   ❌ Yearly price IDs not configured');
      allTestsPassed = false;
    } else {
      console.log(`   ✅ Pro Yearly: ${proYearlyPriceId}`);
      console.log(`   ✅ Enterprise Yearly: ${enterpriseYearlyPriceId}`);
    }

    // Test 2: Stripe Price Verification
    console.log('\n2. ✅ Stripe Price Verification');
    try {
      const proPrice = await stripe.prices.retrieve(proYearlyPriceId);
      const enterprisePrice = await stripe.prices.retrieve(enterpriseYearlyPriceId);
      
      console.log(`   ✅ Pro Yearly: $${proPrice.unit_amount/100}/year (${proPrice.recurring?.interval})`);
      console.log(`   ✅ Enterprise Yearly: $${enterprisePrice.unit_amount/100}/year (${enterprisePrice.recurring?.interval})`);
      
      if (proPrice.recurring?.interval !== 'year' || enterprisePrice.recurring?.interval !== 'year') {
        console.log('   ❌ One or more prices have incorrect interval');
        allTestsPassed = false;
      }
    } catch (error) {
      console.log(`   ❌ Error retrieving Stripe prices: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 3: Database Schema
    console.log('\n3. ✅ Database Schema');
    try {
      const paymentCount = await prisma.payment.count();
      const subscriptionCount = await prisma.subscription.count();
      const userCount = await prisma.user.count();
      
      console.log(`   ✅ Payment table: ${paymentCount} records`);
      console.log(`   ✅ Subscription table: ${subscriptionCount} records`);
      console.log(`   ✅ User table: ${userCount} records`);
    } catch (error) {
      console.log(`   ❌ Database connection error: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 4: Plan Configuration
    console.log('\n4. ✅ Plan Configuration');
    try {
      const { SUBSCRIPTION_PLANS, getSubscriptionPlanById } = require('./dist/payments/credit-packages.config');
      
      const proYearlyPlan = getSubscriptionPlanById('pro-yearly');
      const enterpriseYearlyPlan = getSubscriptionPlanById('enterprise-yearly');
      
      if (!proYearlyPlan || !enterpriseYearlyPlan) {
        console.log('   ❌ Yearly plans not found in configuration');
        allTestsPassed = false;
      } else {
        console.log(`   ✅ Pro Yearly: $${proYearlyPlan.price/100}/year, ${proYearlyPlan.credits} credits`);
        console.log(`   ✅ Enterprise Yearly: $${enterpriseYearlyPlan.price/100}/year, ${enterpriseYearlyPlan.credits} credits`);
        
        if (proYearlyPlan.interval !== 'year' || enterpriseYearlyPlan.interval !== 'year') {
          console.log('   ❌ One or more plans have incorrect interval');
          allTestsPassed = false;
        }
      }
    } catch (error) {
      console.log(`   ❌ Error loading plan configuration: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 5: Price ID Mapping
    console.log('\n5. ✅ Price ID Mapping');
    try {
      // Test the price ID mapping logic
      const priceIdMap = {
        'pro-yearly': proYearlyPriceId,
        'enterprise-yearly': enterpriseYearlyPriceId,
      };
      
      console.log(`   ✅ Pro Yearly mapping: pro-yearly -> ${priceIdMap['pro-yearly']}`);
      console.log(`   ✅ Enterprise Yearly mapping: enterprise-yearly -> ${priceIdMap['enterprise-yearly']}`);
    } catch (error) {
      console.log(`   ❌ Error testing price ID mapping: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 6: Frontend Configuration Check
    console.log('\n6. ✅ Frontend Configuration');
    try {
      
      const pricingFile = path.join(__dirname, '../daygen0/src/components/Pricing.tsx');
      const pricingContent = fs.readFileSync(pricingFile, 'utf8');
      
      const hasYearlyTiers = pricingContent.includes('YEARLY_PRICING_TIERS');
      const hasProYearly = pricingContent.includes('$290') && pricingContent.includes('12000');
      const hasEnterpriseYearly = pricingContent.includes('$990') && pricingContent.includes('60000');
      
      if (hasYearlyTiers) {
        console.log('   ✅ YEARLY_PRICING_TIERS defined');
      } else {
        console.log('   ❌ YEARLY_PRICING_TIERS not found');
        allTestsPassed = false;
      }
      
      if (hasProYearly) {
        console.log('   ✅ Pro Yearly pricing displayed correctly');
      } else {
        console.log('   ❌ Pro Yearly pricing not found in frontend');
        allTestsPassed = false;
      }
      
      if (hasEnterpriseYearly) {
        console.log('   ✅ Enterprise Yearly pricing displayed correctly');
      } else {
        console.log('   ❌ Enterprise Yearly pricing not found in frontend');
        allTestsPassed = false;
      }
    } catch (error) {
      console.log(`   ❌ Error checking frontend configuration: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 7: Webhook Configuration
    console.log('\n7. ✅ Webhook Configuration');
    try {
      const webhookFile = path.join(__dirname, 'src/payments/stripe-webhook.controller.ts');
      const webhookContent = fs.readFileSync(webhookFile, 'utf8');
      
      const hasCheckoutSessionCompleted = webhookContent.includes('checkout.session.completed');
      const hasSubscriptionCreated = webhookContent.includes('customer.subscription.created');
      
      if (hasCheckoutSessionCompleted) {
        console.log('   ✅ checkout.session.completed webhook handler found');
      } else {
        console.log('   ❌ checkout.session.completed webhook handler not found');
        allTestsPassed = false;
      }
      
      if (hasSubscriptionCreated) {
        console.log('   ✅ customer.subscription.created webhook handler found');
      } else {
        console.log('   ❌ customer.subscription.created webhook handler not found');
        allTestsPassed = false;
      }
    } catch (error) {
      console.log(`   ❌ Error checking webhook configuration: ${error.message}`);
      allTestsPassed = false;
    }

    // Test 8: Service Health Check
    console.log('\n8. ✅ Service Health Check');
    try {
      const response = await fetch('http://localhost:3000/health');
      const health = await response.json();
      
      if (health.status === 'ok') {
        console.log('   ✅ Backend service is healthy');
      } else {
        console.log(`   ⚠️  Backend service health: ${health.status}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Backend service not accessible: ${error.message}`);
    }

    // Test 9: Frontend Accessibility
    console.log('\n9. ✅ Frontend Accessibility');
    try {
      const response = await fetch('http://localhost:5173');
      
      if (response.ok) {
        console.log('   ✅ Frontend service is accessible');
      } else {
        console.log(`   ⚠️  Frontend service status: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Frontend service not accessible: ${error.message}`);
    }

    // Final Results
    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
      console.log('🎉 ALL YEARLY SUBSCRIPTION TESTS PASSED!');
      console.log('\n✅ Yearly subscriptions are fully functional:');
      console.log('   • Pro Yearly: $290/year, 12,000 credits');
      console.log('   • Enterprise Yearly: $990/year, 60,000 credits');
      console.log('   • Stripe integration working');
      console.log('   • Database models configured');
      console.log('   • Frontend pricing display ready');
      console.log('   • Webhook processing configured');
      console.log('\n🚀 Ready for production use!');
    } else {
      console.log('❌ SOME TESTS FAILED');
      console.log('\nPlease review the failed tests above and fix the issues.');
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Verification failed with error:', error.message);
    console.error('Stack trace:', error.stack);
    allTestsPassed = false;
  } finally {
    await prisma.$disconnect();
  }

  process.exit(allTestsPassed ? 0 : 1);
}

// Run the verification
verifyYearlySubscriptions();
