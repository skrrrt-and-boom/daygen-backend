#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function testCreditAddition() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing credit addition...');
    
    // Find a test user
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
    
    // Test the apply_credit_delta function directly
    console.log('💰 Testing apply_credit_delta function...');
    
    const result = await prisma.$queryRawUnsafe(
      'SELECT public.apply_credit_delta($1, $2, $3, $4, $5, $6, $7, $8, $9) as apply_credit_delta',
      user.authUserId,
      100, // Add 100 credits
      'PAYMENT',
      'PAYMENT',
      'test-payment-123',
      'stripe',
      'payment',
      null,
      JSON.stringify({ paymentId: 'test-payment-123', type: 'credit_purchase' })
    );
    
    console.log('✅ Credit addition result:', result);
    
    // Check the user's new balance
    const updatedUser = await prisma.user.findUnique({
      where: { authUserId: user.authUserId },
      select: { credits: true }
    });
    
    console.log(`🎉 User now has ${updatedUser.credits} credits`);
    
    // Check the credit ledger
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

testCreditAddition();
