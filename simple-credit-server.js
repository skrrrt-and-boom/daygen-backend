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
    console.log('🧪 Adding credits via simple server...');

    const testUser = await prisma.user.findFirst({
      where: {
        email: 'domin6051@gmail.com'
      }
    });

    if (!testUser) {
      return res.status(404).json({ message: 'Test user not found' });
    }

    const creditsToAdd = 12000; // Pro plan credits
    const newBalance = testUser.credits + creditsToAdd;

    console.log(`💰 Adding ${creditsToAdd} credits to user ${testUser.email} (${testUser.credits} → ${newBalance})`);

    // Update user credits
    await prisma.user.update({
      where: { authUserId: testUser.authUserId },
      data: { credits: newBalance }
    });

    console.log(`✅ Successfully added ${creditsToAdd} credits to user ${testUser.email}. New balance: ${newBalance}`);
    
    res.json({ 
      message: `Successfully added ${creditsToAdd} credits to user ${testUser.email}`, 
      creditsAdded: creditsToAdd, 
      newBalance,
      success: true
    });
  } catch (error) {
    console.error('💥 Error adding credits directly:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🧪 Simple credit server running on port ${PORT}`);
  console.log(`   Endpoint: POST http://localhost:${PORT}/api/test/add-credits`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
});
