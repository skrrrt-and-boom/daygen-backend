#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
    }
  }
});

async function createTestUser() {
  try {
    console.log('Creating test user...');
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: 'test@example.com' }
    });
    
    if (existingUser) {
      console.log('User already exists, deleting...');
      await prisma.user.delete({
        where: { email: 'test@example.com' }
      });
    }
    
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        displayName: 'Test User',
        authUserId: 'test-user-123',
        credits: 100
      }
    });
    
    console.log('Test user created successfully:', {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      authUserId: user.authUserId,
      credits: user.credits
    });
    
  } catch (error) {
    console.error('Error creating test user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();
