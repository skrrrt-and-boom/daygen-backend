#!/usr/bin/env node

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Simple credit addition endpoint
app.post('/api/test/add-credits', async (req, res) => {
  try {
    console.log('🧪 Adding credits via test endpoint...');
    
    // Find the test user
    const testUser = await prisma.user.findFirst({
      where: {
        email: 'domin6051@gmail.com'
      }
    });
    
    if (!testUser) {
      return res.status(404).json({ error: 'Test user not found' });
    }
    
    const creditsToAdd = 1000;
    const newBalance = testUser.credits + creditsToAdd;
    
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
        sourceId: 'test-endpoint',
        provider: 'stripe',
        model: 'payment',
        promptHash: null,
        metadata: JSON.stringify({ 
          type: 'test_endpoint',
          testMode: true 
        })
      }
    });
    
    res.json({
      message: `Successfully added ${creditsToAdd} credits to ${testUser.email}`,
      creditsAdded: creditsToAdd,
      newBalance: newBalance
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🧪 Test server running on port ${PORT}`);
  console.log(`   Endpoint: POST http://localhost:${PORT}/api/test/add-credits`);
});
