#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function checkCredits() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Checking user credits...');
    
    // Check all users
    const users = await prisma.user.findMany({
      select: {
        authUserId: true,
        email: true,
        credits: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });
    
    console.log('\n👥 Users in database:');
    users.forEach(user => {
      console.log(`  - ${user.email} (${user.authUserId}): ${user.credits} credits`);
    });
    
    // Check credit ledger
    console.log('\n📊 Credit Ledger entries:');
    const ledger = await prisma.creditLedger.findMany({
      select: {
        userId: true,
        delta: true,
        balanceAfter: true,
        reason: true,
        sourceType: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });
    
    ledger.forEach(entry => {
      console.log(`  - User ${entry.userId}: ${entry.delta > 0 ? '+' : ''}${entry.delta} credits (balance: ${entry.balanceAfter}) - ${entry.reason} (${entry.sourceType})`);
    });
    
    // Check payments
    console.log('\n💳 Recent payments:');
    const payments = await prisma.payment.findMany({
      select: {
        id: true,
        userId: true,
        amount: true,
        credits: true,
        status: true,
        type: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });
    
    payments.forEach(payment => {
      console.log(`  - Payment ${payment.id}: ${payment.credits} credits, $${payment.amount/100}, status: ${payment.status}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkCredits();
