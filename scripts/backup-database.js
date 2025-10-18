#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function cleanupEmptyBackups() {
  const backupDir = './backups';
  if (!fs.existsSync(backupDir)) return;
  
  const files = fs.readdirSync(backupDir);
  let cleanedCount = 0;
  
  files.forEach(file => {
    if (file.endsWith('.sql') && !file.endsWith('.gz')) {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        console.log('🧹 Cleaning up empty backup file:', file);
        fs.unlinkSync(filePath);
        cleanedCount++;
      }
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`✅ Cleaned up ${cleanedCount} empty backup file(s)`);
  }
}

async function checkPostgreSQLVersion() {
  return new Promise((resolve, reject) => {
    exec('pg_dump --version', (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PostgreSQL client not found: ${error.message}`));
        return;
      }
      
      const version = stdout.trim();
      console.log('🔍 PostgreSQL client version:', version);
      
      // Check if version is 17.x (recommended)
      const versionMatch = version.match(/pg_dump \(PostgreSQL\) (\d+)\./);
      if (versionMatch) {
        const majorVersion = parseInt(versionMatch[1]);
        if (majorVersion < 14) {
          console.warn('⚠️  Warning: PostgreSQL version', majorVersion, 'is quite old. Consider upgrading to version 17.');
        } else if (majorVersion >= 17) {
          console.log('✅ PostgreSQL version', majorVersion, 'is recommended');
        }
        resolve(version);
      } else {
        console.warn('⚠️  Could not parse PostgreSQL version, continuing anyway...');
        resolve(version);
      }
    });
  });
}

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

  // Clean up any existing empty backup files
  await cleanupEmptyBackups();

  // Check PostgreSQL version first
  try {
    await checkPostgreSQLVersion();
  } catch (error) {
    console.error('❌ PostgreSQL version check failed:', error.message);
    console.log('💡 Make sure PostgreSQL client is installed and in PATH');
    console.log('   On macOS: brew install postgresql@17');
    console.log('   Then: export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"');
    process.exit(1);
  }

  // Create backup directory
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('📁 Created backup directory:', backupDir);
  }

  console.log('🔄 Creating database backup...');
  console.log('📄 Backup file:', backupFile);
  
  // Check if using Supavisor (pooler) connection for better IPv4 compatibility
  if (dbUrl.includes('pooler.supabase.com')) {
    console.log('✅ Using Supavisor connection pooler (IPv4 compatible)');
  } else if (dbUrl.includes('supabase.co')) {
    console.log('⚠️ Using direct Supabase connection - may have IPv6 issues');
    console.log('💡 Consider using Supavisor connection string for better compatibility');
    console.log('   Get it from: Supabase Dashboard > Settings > Database > Connection Pooling');
  }
  
    // Create backup
    const command = `pg_dump "${dbUrl}" > "${backupPath}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Backup failed:', error.message);
        if (stderr) console.error('Error details:', stderr);
        
        // Check for common error patterns and provide helpful messages
        if (stderr.includes('server version') && stderr.includes('pg_dump version')) {
          console.log('💡 This is a PostgreSQL version mismatch error.');
          console.log('   Solution: Use PostgreSQL 17 client');
          console.log('   Run: export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"');
        } else if (stderr.includes('connection to server') || stderr.includes('Network is unreachable')) {
          console.log('💡 This is a database connection error.');
          console.log('   Common solutions:');
          console.log('   1. Use Supavisor connection string (pooler.supabase.com)');
          console.log('   2. Check if your IP is banned: supabase network-bans get --project-ref <ref>');
          console.log('   3. Verify DATABASE_URL is correct');
          console.log('   4. Check network connectivity');
        }
        
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
          console.log('🧹 Cleaning up empty backup file...');
          fs.unlinkSync(backupPath);
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

Features:
  ✅ PostgreSQL version checking
  ✅ Automatic empty file cleanup
  ✅ Enhanced error messages
  ✅ Compression with gzip
  ✅ File size reporting

Examples:
  DATABASE_URL="postgresql://..." node scripts/backup-database.js
  npm run backup:db

Requirements:
  - PostgreSQL client (version 17 recommended)
  - On macOS: brew install postgresql@17
  - Add to PATH: export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
`);
  process.exit(0);
}

backupDatabase();
