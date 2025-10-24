#!/usr/bin/env node

/**
 * Migration script to update subscription records from placeholder price IDs to real Stripe price IDs
 * 
 * This script:
 * 1. Connects to the database
 * 2. Finds all subscriptions with placeholder price IDs
 * 3. Updates them to use real Stripe price IDs from environment variables
 * 4. Provides detailed logging of changes
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// Mapping from placeholder IDs to real Stripe price IDs
const PRICE_ID_MAPPING = {
  // Pro plans
  'price_pro': process.env.STRIPE_PRO_PRICE_ID,
  'pro': process.env.STRIPE_PRO_PRICE_ID,
  'price_pro_yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  'pro-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  
  // Enterprise plans
  'price_enterprise': process.env.STRIPE_ENTERPRISE_PRICE_ID,
  'enterprise': process.env.STRIPE_ENTERPRISE_PRICE_ID,
  'price_enterprise_yearly': process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID,
  'enterprise-yearly': process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID,
};

async function main() {
  console.log('🔄 Starting subscription price ID migration...\n');
  
  // Validate environment variables
  console.log('📋 Environment variables:');
  Object.entries(PRICE_ID_MAPPING).forEach(([placeholder, realId]) => {
    if (realId) {
      console.log(`  ✅ ${placeholder} → ${realId}`);
    } else {
      console.log(`  ❌ ${placeholder} → MISSING ENV VAR`);
    }
  });
  console.log('');

  // Check for missing environment variables
  const missingEnvVars = Object.entries(PRICE_ID_MAPPING)
    .filter(([_, realId]) => !realId)
    .map(([placeholder, _]) => placeholder);
    
  if (missingEnvVars.length > 0) {
    console.error('❌ Missing environment variables for:', missingEnvVars.join(', '));
    console.error('Please check your .env file and ensure all Stripe price IDs are set.');
    process.exit(1);
  }

  try {
    // Get all subscriptions with placeholder price IDs
    const placeholderIds = Object.keys(PRICE_ID_MAPPING);
    const subscriptions = await prisma.subscription.findMany({
      where: {
        stripePriceId: {
          in: placeholderIds
        }
      },
      select: {
        id: true,
        userId: true,
        stripePriceId: true,
        status: true,
        createdAt: true
      }
    });

    console.log(`📊 Found ${subscriptions.length} subscriptions with placeholder price IDs:\n`);
    
    if (subscriptions.length === 0) {
      console.log('✅ No subscriptions need updating. All price IDs are already real Stripe IDs.');
      return;
    }

    // Display current subscriptions
    subscriptions.forEach(sub => {
      console.log(`  - ID: ${sub.id}`);
      console.log(`    User: ${sub.userId}`);
      console.log(`    Current Price ID: ${sub.stripePriceId}`);
      console.log(`    Status: ${sub.status}`);
      console.log(`    Created: ${sub.createdAt.toISOString()}`);
      console.log('');
    });

    // Update each subscription
    let updatedCount = 0;
    const updateResults = [];

    for (const subscription of subscriptions) {
      const newPriceId = PRICE_ID_MAPPING[subscription.stripePriceId];
      
      if (!newPriceId) {
        console.log(`⚠️  Skipping ${subscription.id}: No mapping found for ${subscription.stripePriceId}`);
        continue;
      }

      try {
        const updated = await prisma.subscription.update({
          where: { id: subscription.id },
          data: { stripePriceId: newPriceId }
        });

        updateResults.push({
          id: subscription.id,
          userId: subscription.userId,
          oldPriceId: subscription.stripePriceId,
          newPriceId: newPriceId,
          success: true
        });

        console.log(`✅ Updated subscription ${subscription.id}:`);
        console.log(`   ${subscription.stripePriceId} → ${newPriceId}`);
        updatedCount++;

      } catch (error) {
        console.error(`❌ Failed to update subscription ${subscription.id}:`, error.message);
        updateResults.push({
          id: subscription.id,
          userId: subscription.userId,
          oldPriceId: subscription.stripePriceId,
          newPriceId: newPriceId,
          success: false,
          error: error.message
        });
      }
    }

    // Summary
    console.log('\n📈 Migration Summary:');
    console.log(`  Total subscriptions found: ${subscriptions.length}`);
    console.log(`  Successfully updated: ${updatedCount}`);
    console.log(`  Failed updates: ${updateResults.filter(r => !r.success).length}`);

    if (updatedCount > 0) {
      console.log('\n🎉 Migration completed successfully!');
      console.log('The system will now use real Stripe price IDs for plan identification.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
main()
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
