#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function backupDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  const backupDir = './backups';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                   new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupFile = `daygen_backup_${timestamp}.sql`;
  const backupPath = path.join(backupDir, backupFile);

  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    console.log('Please set DATABASE_URL in your .env file or environment');
    process.exit(1);
  }

  // Create backup directory
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('📁 Created backup directory:', backupDir);
  }

  console.log('🔄 Creating database backup...');
  console.log('📄 Backup file:', backupFile);
  
    // Create backup
    const command = `pg_dump "${dbUrl}" > "${backupPath}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Backup failed:', error.message);
        if (stderr) console.error('Error details:', stderr);
        process.exit(1);
      }
      
      // Check if backup file was created and has content
      if (fs.existsSync(backupPath)) {
        const stats = fs.statSync(backupPath);
        if (stats.size > 0) {
          console.log('✅ Backup created successfully');
          console.log('📊 File size:', (stats.size / 1024).toFixed(2), 'KB');
          
          // Compress backup
          console.log('🗜️ Compressing backup...');
          exec(`gzip "${backupPath}"`, (compressError) => {
            if (compressError) {
              console.error('❌ Compression failed:', compressError.message);
              console.log('💡 Backup created but not compressed:', backupPath);
            } else {
              console.log('✅ Backup compressed successfully');
              console.log('📁 Final backup:', `${backupPath}.gz`);
              
              // Show file size
              const compressedStats = fs.statSync(`${backupPath}.gz`);
              console.log('📊 Compressed size:', (compressedStats.size / 1024).toFixed(2), 'KB');
              
              // Show compression ratio
              const originalSize = stats.size;
              const compressedSize = compressedStats.size;
              const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
              console.log('📈 Compression ratio:', ratio + '%');
            }
            
            console.log('🎉 Backup completed successfully!');
            console.log('📁 Backup location:', path.resolve(backupDir));
          });
        } else {
          console.error('❌ Backup file is empty');
          process.exit(1);
        }
      } else {
        console.error('❌ Backup file was not created');
        process.exit(1);
      }
    });
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🗄️  DayGen Database Backup Tool

Usage:
  node scripts/backup-database.js [options]

Options:
  --help, -h     Show this help message

Environment Variables:
  DATABASE_URL   PostgreSQL connection string (required)

Examples:
  DATABASE_URL="postgresql://..." node scripts/backup-database.js
  npm run backup:db
`);
  process.exit(0);
}

backupDatabase();
