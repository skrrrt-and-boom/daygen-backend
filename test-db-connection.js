const { PrismaClient } = require('@prisma/client');

async function testDatabaseConnection() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Testing database connection...');
    
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // Test user creation
    const testUser = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        authUserId: `test-auth-${Date.now()}`,
        passwordHash: 'test-hash',
        displayName: 'Test User',
      },
    });
    console.log('✅ User creation successful:', testUser.id);
    
    // Test job creation
    const testJob = await prisma.job.create({
      data: {
        userId: testUser.authUserId,
        type: 'IMAGE_GENERATION',
        status: 'PENDING',
        metadata: { test: true },
      },
    });
    console.log('✅ Job creation successful:', testJob.id);
    
    // Clean up
    await prisma.job.delete({ where: { id: testJob.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('✅ Cleanup successful');
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Error details:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabaseConnection();
