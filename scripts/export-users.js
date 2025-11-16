#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportUsers() {
  const backupDir = './backups';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                   new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupFile = `users_export_${timestamp}.json`;
  const backupPath = path.join(backupDir, backupFile);

  try {
    console.log('🔄 Exporting users data...');

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log('📁 Created backup directory:', backupDir);
    }

    // Export all users with related data
    const users = await prisma.user.findMany({
      include: {
        usageEvents: {
          orderBy: { createdAt: 'desc' }
        },
        r2Files: {
          orderBy: { createdAt: 'desc' }
        },
        jobs: {
          orderBy: { createdAt: 'desc' }
        },
      },
    });

    const backup = {
      timestamp: new Date().toISOString(),
      exportType: 'users_with_relations',
      totalUsers: users.length,
      users: users,
      summary: {
        totalUsageEvents: users.reduce((sum, user) => sum + user.usageEvents.length, 0),
        totalR2Files: users.reduce((sum, user) => sum + user.r2Files.length, 0),
        totalJobs: users.reduce((sum, user) => sum + user.jobs.length, 0),
        totalCredits: users.reduce((sum, user) => sum + user.credits, 0),
      }
    };

    // Write backup to file
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    const stats = fs.statSync(backupPath);
    console.log('✅ Users export completed successfully');
    console.log('📊 Total users:', users.length);
    console.log('📊 Total usage events:', backup.summary.totalUsageEvents);
    console.log('📊 Total R2 files:', backup.summary.totalR2Files);
    console.log('📊 Total jobs:', backup.summary.totalJobs);
    console.log('📊 Total credits:', backup.summary.totalCredits);
    console.log('📁 File size:', (stats.size / 1024).toFixed(2), 'KB');
    console.log('📁 Export location:', path.resolve(backupPath));

    // Compress the backup
    console.log('🗜️ Compressing export...');
    const { exec } = require('child_process');
    exec(`gzip "${backupPath}"`, (error) => {
      if (error) {
        console.log('⚠️ Compression failed, but export is complete');
      } else {
        const compressedStats = fs.statSync(`${backupPath}.gz`);
        const ratio = ((stats.size - compressedStats.size) / stats.size * 100).toFixed(1);
        console.log('✅ Export compressed successfully');
        console.log('📊 Compressed size:', (compressedStats.size / 1024).toFixed(2), 'KB');
        console.log('📈 Compression ratio:', ratio + '%');
        console.log('📁 Final export:', `${backupPath}.gz`);
      }
    });

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
👥 DayGen Users Export Tool

Usage:
  node scripts/export-users.js [options]

Options:
  --help, -h     Show this help message

Description:
  Exports all users with their related data (usage events, R2 files, jobs)
  to a JSON file for backup purposes.

Examples:
  npm run backup:users
  node scripts/export-users.js
`);
  process.exit(0);
}

exportUsers();
