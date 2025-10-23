#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function testDirectCreditAddition() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing direct credit addition...');
    
    // Find the test user
    const user = await prisma.user.findFirst({
      where: {
        email: 'domin6051@gmail.com'
      }
    });
    
    if (!user) {
      console.log('❌ Test user not found');
      return;
    }
    
    console.log(`👤 Found user: ${user.email} with ${user.credits} credits`);
    
    // Directly update credits and create ledger entry
    const creditsToAdd = 100;
    const newBalance = user.credits + creditsToAdd;
    
    console.log(`💰 Adding ${creditsToAdd} credits (${user.credits} → ${newBalance})`);
    
    // Update user credits
    await prisma.user.update({
      where: { authUserId: user.authUserId },
      data: { credits: newBalance }
    });
    
    console.log('✅ User credits updated');
    
    // Create ledger entry
    await prisma.creditLedger.create({
      data: {
        userId: user.authUserId,
        delta: creditsToAdd,
        balanceAfter: newBalance,
        reason: 'PAYMENT',
        sourceType: 'PAYMENT',
        sourceId: 'test-payment-direct',
        provider: 'stripe',
        model: 'payment',
        promptHash: null,
        metadata: JSON.stringify({ paymentId: 'test-payment-direct', type: 'credit_purchase' })
      }
    });
    
    console.log('✅ Ledger entry created');
    
    // Verify the changes
    const updatedUser = await prisma.user.findUnique({
      where: { authUserId: user.authUserId },
      select: { credits: true }
    });
    
    console.log(`🎉 User now has ${updatedUser.credits} credits`);
    
    // Check ledger entries
    const ledgerEntries = await prisma.creditLedger.findMany({
      where: { userId: user.authUserId },
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    
    console.log('📊 Recent ledger entries:');
    ledgerEntries.forEach(entry => {
      console.log(`  - ${entry.delta > 0 ? '+' : ''}${entry.delta} credits (balance: ${entry.balanceAfter}) - ${entry.reason}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testDirectCreditAddition();
