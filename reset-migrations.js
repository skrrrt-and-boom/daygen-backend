const { PrismaClient } = require('@prisma/client');

async function resetMigrations() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Resetting migration state...');
    
    // Check current migration status
    console.log('Checking current migration status...');
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at 
      FROM _prisma_migrations 
      ORDER BY finished_at DESC
    `;
    console.log('Current migrations:', migrations);
    
    // Reset the failed migration
    console.log('Resetting failed migration...');
    await prisma.$executeRaw`
      DELETE FROM _prisma_migrations 
      WHERE migration_name = '20250128000002_remove_unused_tables'
    `;
    
    // Mark it as applied since we already cleaned up manually
    console.log('Marking cleanup migration as applied...');
    await prisma.$executeRaw`
      INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES (
        '20250128000002_remove_unused_tables',
        '20250128000002_remove_unused_tables',
        NOW(),
        '20250128000002_remove_unused_tables',
        NULL,
        NULL,
        NOW(),
        1
      )
    `;
    
    console.log('✅ Migration state reset successfully');
    
  } catch (error) {
    console.error('❌ Reset failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

resetMigrations();
