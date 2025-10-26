#!/usr/bin/env node

/**
 * Stripe Payment Sync Script
 * 
 * This script checks for successful Stripe payments that may have been missed
 * due to webhook failures and syncs them with the local database.
 * 
 * Usage:
 *   node scripts/sync-stripe-payments.js [options]
 * 
 * Options:
 *   --dry-run    Show what would be synced without making changes
 *   --days=7     Number of days back to check (default: 7)
 *   --help       Show this help message
 */

const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

// Configuration
const config = {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  daysBack: 7,
  dryRun: false,
};

// Parse command line arguments
const args = process.argv.slice(2);
args.forEach(arg => {
  if (arg === '--dry-run') {
    config.dryRun = true;
  } else if (arg.startsWith('--days=')) {
    config.daysBack = parseInt(arg.split('=')[1]) || 7;
  } else if (arg === '--help') {
    console.log(`
Stripe Payment Sync Script

This script checks for successful Stripe payments that may have been missed
due to webhook failures and syncs them with the local database.

Usage:
  node scripts/sync-stripe-payments.js [options]

Options:
  --dry-run    Show what would be synced without making changes
  --days=7     Number of days back to check (default: 7)
  --help       Show this help message

Environment Variables:
  STRIPE_SECRET_KEY      Your Stripe secret key
  STRIPE_WEBHOOK_SECRET  Your Stripe webhook secret (optional)
    `);
    process.exit(0);
  }
});

// Validate configuration
if (!config.stripeSecretKey) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required');
  process.exit(1);
}

// Initialize services
const prisma = new PrismaClient();
const stripe = new Stripe(config.stripeSecretKey);

// Helper functions
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function logSuccess(message) {
  const timestamp = new Date().toISOString();
  console.log(`✅ [${timestamp}] ${message}`);
}

async function syncCheckoutSession(session) {
  try {
    // Check if payment already exists in database
    const existingPayment = await prisma.payment.findUnique({
      where: { stripeSessionId: session.id }
    });

    if (existingPayment) {
      log(`Payment already exists for session ${session.id}`);
      return { synced: false, reason: 'already_exists' };
    }

    // Get session details
    const sessionDetails = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'payment_intent']
    });

    if (sessionDetails.payment_status !== 'paid') {
      log(`Session ${session.id} is not paid (status: ${sessionDetails.payment_status})`);
      return { synced: false, reason: 'not_paid' };
    }

    // Extract metadata
    const metadata = sessionDetails.metadata || {};
    const userId = metadata.userId;
    
    if (!userId) {
      log(`No userId found in session ${session.id} metadata`);
      return { synced: false, reason: 'no_user_id' };
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { authUserId: userId }
    });

    if (!user) {
      log(`User not found for authUserId: ${userId}`);
      return { synced: false, reason: 'user_not_found' };
    }

    // Determine payment type and amount
    const isSubscription = sessionDetails.mode === 'subscription';
    const lineItem = sessionDetails.line_items?.data[0];
    const amount = sessionDetails.amount_total || 0;
    
    // Calculate credits using Plan when possible
    let credits = 0;
    if (isSubscription) {
      // Use line item price id or metadata priceId
      const priceId = lineItem?.price?.id || metadata.priceId;
      if (priceId) {
        const plan = await prisma.plan.findUnique({ where: { stripePriceId: priceId } });
        if (plan) {
          credits = plan.creditsPerPeriod;
        }
      }
      if (!credits && metadata.credits) {
        credits = parseInt(metadata.credits);
      }
    } else {
      credits = metadata.credits ? parseInt(metadata.credits) : Math.floor(amount / 10);
    }

    if (config.dryRun) {
      log(`[DRY RUN] Would sync payment for user ${userId}: ${credits} credits, $${amount/100}`);
      return { synced: true, reason: 'dry_run' };
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        userId: userId,
        stripeSessionId: session.id,
        stripePaymentIntentId: sessionDetails.payment_intent?.id,
        amount: amount,
        credits: credits,
        status: 'COMPLETED',
        type: isSubscription ? 'SUBSCRIPTION' : 'ONE_TIME',
        metadata: {
          syncedBy: 'stripe-sync-script',
          syncedAt: new Date().toISOString(),
          originalMetadata: metadata,
        },
      },
    });

    // Add credits to user
    await prisma.$transaction(async (tx) => {
      const userRecord = await tx.user.findUnique({
        where: { authUserId: userId },
        select: { credits: true },
      });

      if (!userRecord) {
        throw new Error('User not found for credit addition');
      }

      const newBalance = userRecord.credits + credits;

      await tx.user.update({
        where: { authUserId: userId },
        data: { credits: newBalance },
      });

      await tx.usageEvent.create({
        data: {
          userAuthId: userId,
          provider: 'stripe',
          model: 'payment',
          prompt: `Synced ${credits} credits from missed webhook`,
          cost: -credits,
          balanceAfter: newBalance,
          status: 'COMPLETED',
          metadata: {
            paymentId: payment.id,
            type: 'credit_sync',
            syncedBy: 'stripe-sync-script',
          },
        },
      });
    });

    logSuccess(`Synced payment for user ${userId}: ${credits} credits, $${amount/100}`);
    return { synced: true, reason: 'success' };

  } catch (error) {
    log(`Error syncing session ${session.id}: ${error.message}`, 'error');
    return { synced: false, reason: 'error', error: error.message };
  }
}

async function syncSubscription(subscription) {
  try {
    // Check if subscription already exists
    const existingSubscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id }
    });

    if (existingSubscription) {
      log(`Subscription already exists: ${subscription.id}`);
      return { synced: false, reason: 'already_exists' };
    }

    // Get customer details
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    if (!customer.email) {
      log(`Customer ${subscription.customer} has no email`);
      return { synced: false, reason: 'no_email' };
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: customer.email }
    });

    if (!user) {
      log(`User not found for email: ${customer.email}`);
      return { synced: false, reason: 'user_not_found' };
    }

    // Get subscription plan details
    const priceId = subscription.items.data[0]?.price.id;
    let credits = 0;
    if (priceId) {
      const plan = await prisma.plan.findUnique({ where: { stripePriceId: priceId } });
      credits = plan ? plan.creditsPerPeriod : 0;
    }
    if (!credits) credits = 1000; // fallback

    if (config.dryRun) {
      log(`[DRY RUN] Would sync subscription for user ${user.authUserId}: ${credits} credits/month`);
      return { synced: true, reason: 'dry_run' };
    }

    // Create subscription record
    await prisma.subscription.create({
      data: {
        userId: user.authUserId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        credits: credits,
      },
    });

    logSuccess(`Synced subscription for user ${user.authUserId}: ${credits} credits/month`);
    return { synced: true, reason: 'success' };

  } catch (error) {
    log(`Error syncing subscription ${subscription.id}: ${error.message}`, 'error');
    return { synced: false, reason: 'error', error: error.message };
  }
}

async function main() {
  log(`Starting Stripe payment sync (${config.dryRun ? 'DRY RUN' : 'LIVE'})`);
  log(`Checking payments from the last ${config.daysBack} days`);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - config.daysBack);
  
  let totalSessions = 0;
  let syncedSessions = 0;
  let totalSubscriptions = 0;
  let syncedSubscriptions = 0;

  try {
    // Sync checkout sessions
    log('Syncing checkout sessions...');
    let hasMore = true;
    let startingAfter = undefined;

    while (hasMore) {
      const sessions = await stripe.checkout.sessions.list({
        limit: 100,
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
        },
        ...(startingAfter && { starting_after: startingAfter }),
      });

      for (const session of sessions.data) {
        totalSessions++;
        const result = await syncCheckoutSession(session);
        if (result.synced) {
          syncedSessions++;
        }
      }

      hasMore = sessions.has_more;
      if (hasMore) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      }
    }

    // Sync subscriptions
    log('Syncing subscriptions...');
    hasMore = true;
    startingAfter = undefined;

    while (hasMore) {
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
        },
        status: 'active',
        ...(startingAfter && { starting_after: startingAfter }),
      });

      for (const subscription of subscriptions.data) {
        totalSubscriptions++;
        const result = await syncSubscription(subscription);
        if (result.synced) {
          syncedSubscriptions++;
        }
      }

      hasMore = subscriptions.has_more;
      if (hasMore) {
        startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
      }
    }

    // Summary
    logSuccess(`Sync completed!`);
    log(`Checkout sessions: ${syncedSessions}/${totalSessions} synced`);
    log(`Subscriptions: ${syncedSubscriptions}/${totalSubscriptions} synced`);
    
    if (config.dryRun) {
      log('This was a dry run. No changes were made.');
      log('Run without --dry-run to actually sync the payments.');
    }

  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Run the script
main().catch(async (error) => {
  log(`Unhandled error: ${error.message}`, 'error');
  await prisma.$disconnect();
  process.exit(1);
});
