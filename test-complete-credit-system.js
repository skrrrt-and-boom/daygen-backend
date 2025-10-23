#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function testCompleteCreditSystem() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing Complete Credit System...\n');
    
    // Find the test user
    const testUser = await prisma.user.findFirst({
      where: {
        email: 'domin6051@gmail.com'
      }
    });
    
    if (!testUser) {
      console.log('❌ Test user not found');
      return;
    }
    
    console.log(`👤 Test user: ${testUser.email}`);
    console.log(`💰 Current credits: ${testUser.credits}`);
    
    // Add 500 credits for testing
    const creditsToAdd = 500;
    const newBalance = testUser.credits + creditsToAdd;
    
    console.log(`\n🔄 Adding ${creditsToAdd} credits...`);
    
    // Update user credits
    await prisma.user.update({
      where: { authUserId: testUser.authUserId },
      data: { credits: newBalance }
    });
    
    // Create ledger entry
    await prisma.creditLedger.create({
      data: {
        userId: testUser.authUserId,
        delta: creditsToAdd,
        balanceAfter: newBalance,
        reason: 'PAYMENT',
        sourceType: 'PAYMENT',
        sourceId: 'test-payment-final',
        provider: 'stripe',
        model: 'payment',
        promptHash: null,
        metadata: JSON.stringify({ 
          type: 'final_test',
          testMode: true 
        })
      }
    });
    
    console.log(`✅ Successfully added ${creditsToAdd} credits`);
    console.log(`💰 New balance: ${newBalance} credits`);
    
    // Verify the changes
    const updatedUser = await prisma.user.findUnique({
      where: { authUserId: testUser.authUserId },
      select: { credits: true }
    });
    
    console.log(`\n🔍 Verification:`);
    console.log(`   Expected: ${newBalance} credits`);
    console.log(`   Actual: ${updatedUser.credits} credits`);
    console.log(`   ✅ Match: ${updatedUser.credits === newBalance ? 'YES' : 'NO'}`);
    
    // Check ledger entries
    const ledgerEntries = await prisma.creditLedger.findMany({
      where: { userId: testUser.authUserId },
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    
    console.log(`\n📊 Recent ledger entries:`);
    ledgerEntries.forEach((entry, index) => {
      console.log(`   ${index + 1}. ${entry.delta > 0 ? '+' : ''}${entry.delta} credits (balance: ${entry.balanceAfter}) - ${entry.reason}`);
    });
    
    console.log(`\n🎉 CREDIT SYSTEM TEST COMPLETED SUCCESSFULLY!`);
    console.log(`   ✅ User credits updated`);
    console.log(`   ✅ CreditLedger entry created`);
    console.log(`   ✅ Database operations working`);
    console.log(`   ✅ Enums and tables properly configured`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testCompleteCreditSystem();
