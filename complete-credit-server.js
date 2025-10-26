#!/usr/bin/env node

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Complete credit addition with subscription tracking
app.post('/api/test/complete-payment/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`🧪 COMPLETE PAYMENT PROCESSING for session: ${sessionId}`);

    // Find the test user (in production, this would be based on authentication)
    const testUser = await prisma.user.findFirst({
      where: {
        email: 'domin6051@gmail.com'
      }
    });

    if (!testUser) {
      return res.status(404).json({ message: 'Test user not found' });
    }

    // Resolve plan from DB by a test price id or code if provided
    const priceId = req.query.priceId || 'price_pro_yearly';
    const plan = await prisma.plan.findUnique({ where: { stripePriceId: priceId } });
    const creditsToAdd = plan ? plan.creditsPerPeriod : 12000;
    const newBalance = testUser.credits + creditsToAdd;

    console.log(`💰 Processing payment for user ${testUser.email} (${testUser.credits} → ${newBalance})`);

    // 1. Create Payment record
    const payment = await prisma.payment.create({
      data: {
        userId: testUser.authUserId,
        stripeSessionId: sessionId,
        amount: 29000, // $290 in cents
        credits: creditsToAdd,
        status: 'COMPLETED',
        type: 'SUBSCRIPTION',
        metadata: {
          planId: plan ? plan.code : 'pro-yearly',
          planName: plan ? plan.name : 'Pro Yearly',
          testMode: true
        }
      }
    });

    console.log(`✅ Payment record created: ${payment.id}`);

    // 2. Create Subscription record
    const subscription = await prisma.subscription.create({
      data: {
        userId: testUser.authUserId, // Use authUserId as per the relation
        stripeSubscriptionId: `sub_test_${Date.now()}`,
        stripePriceId: priceId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        cancelAtPeriodEnd: false,
        credits: creditsToAdd // Add the credits field
      }
    });

    console.log(`✅ Subscription record created: ${subscription.id}`);

    // 3. Update User credits
    await prisma.user.update({
      where: { authUserId: testUser.authUserId },
      data: { credits: newBalance }
    });

    console.log(`✅ User credits updated: ${newBalance}`);

    // 4. Create CreditLedger entry (if the table exists)
    try {
      await prisma.creditLedger.create({
        data: {
          userId: testUser.authUserId,
          delta: creditsToAdd,
          balanceAfter: newBalance,
          reason: 'PAYMENT',
          sourceType: 'PAYMENT',
          sourceId: payment.id,
          provider: 'stripe',
          model: 'payment',
          promptHash: null,
          metadata: JSON.stringify({ 
            sessionId, 
            subscriptionId: subscription.id,
            type: 'subscription_payment',
            testMode: true 
          })
        }
      });
      console.log(`✅ CreditLedger entry created`);
    } catch (ledgerError) {
      console.log(`⚠️ CreditLedger creation failed (table might not exist): ${ledgerError.message}`);
    }

    console.log(`🎉 COMPLETE PAYMENT PROCESSING SUCCESSFUL!`);
    
    res.json({ 
      message: `Payment completed successfully! Added ${creditsToAdd} credits to ${testUser.email}`,
      creditsAdded: creditsToAdd, 
      newBalance,
      paymentId: payment.id,
      subscriptionId: subscription.id,
      success: true
    });

  } catch (error) {
    console.error('💥 Error in complete payment processing:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`🎯 Complete credit server running on port ${PORT}`);
  console.log(`   Endpoint: POST http://localhost:${PORT}/api/test/complete-payment/:sessionId`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
});
