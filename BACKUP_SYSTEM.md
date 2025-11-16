# 🗄️ DayGen Database Backup System

This document describes the automated backup system for the DayGen database.

## 📋 Overview

The backup system provides multiple layers of data protection:
- **Automated daily backups** via GitHub Actions
- **Manual backup scripts** for on-demand backups
- **Multiple backup formats** (SQL dumps + JSON exports)
- **Compression** to save storage space
- **Version history** with 30-day retention

## 🚀 Quick Start

### Manual Backups
```bash
# Full backup (database + users)
npm run backup:full

# Database only
npm run backup:db

# Users only
npm run backup:users

# Manual backup with git commit
npm run backup:manual
```

### Automated Backups
- **GitHub Actions** runs daily at 2 AM UTC
- **Manual trigger** available in GitHub Actions tab
- **30-day retention** for backup artifacts

## 📁 Backup Files

### Database Backups
- **Format**: SQL dump compressed with gzip
- **Location**: `./backups/daygen_backup_YYYY-MM-DD_HH-MM-SS.sql.gz`
- **Size**: ~35KB (84.7% compression)
- **Contains**: Complete database schema and data

### User Exports
- **Format**: JSON with relations compressed with gzip
- **Location**: `./backups/users_export_YYYY-MM-DD_HH-MM-SS.json.gz`
- **Size**: ~1KB (66.1% compression)
- **Contains**: Users with usage events, R2 files, and jobs

## 🔧 Configuration

### Environment Variables
```bash
# Use Supavisor (pooler) connection for IPv4 compatibility
DATABASE_URL="postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"

# ❌ Avoid direct connection (IPv6 issues on GitHub Actions)
# DATABASE_URL="postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@db.kxrxsydlhfkkmvwypcqm.supabase.co:5432/postgres"
```

### GitHub Secrets
- `DATABASE_URL`: PostgreSQL connection string (already configured)

## 📊 Backup Statistics

Current database status:
- **Total users**: 5
- **Total usage events**: 0
- **Total R2 files**: 0
- **Total jobs**: 0
- **Total credits**: 100

## 🔄 Recovery Process

### From SQL Backup
```bash
# Decompress backup
gunzip backups/daygen_backup_YYYY-MM-DD_HH-MM-SS.sql.gz

# Restore to database
psql "postgresql://postgres.kxrxsydlhfkkmvwypcqm:Tltcjvkeik93@aws-1-eu-central-1.pooler.supabase.com:6543/postgres" < backups/daygen_backup_YYYY-MM-DD_HH-MM-SS.sql
```

### From JSON Export
```bash
# Decompress backup
gunzip backups/users_export_YYYY-MM-DD_HH-MM-SS.json.gz

# Use the JSON data to restore users programmatically
```

## 🛠️ Maintenance

### Cleanup Old Backups
```bash
# Remove backups older than 7 days
find backups/ -name "*.gz" -mtime +7 -delete
```

### Check Backup Status
```bash
# List all backups
ls -la backups/

# Check backup sizes
du -h backups/*
```

## 📈 Monitoring

### GitHub Actions
- Check **Actions** tab for backup status
- **Green checkmark**: Backup successful
- **Red X**: Backup failed (check logs)

### Local Monitoring
- Backup files are created in `./backups/` directory
- Check file sizes to ensure backups are not empty
- Monitor disk space usage

## 🚨 Troubleshooting

### Common Issues

1. **pg_dump not found**
   ```bash
   # Install PostgreSQL client
   brew install postgresql@17
   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
   ```

2. **Version mismatch**
   ```bash
   # Use correct PostgreSQL version
   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
   ```

3. **Permission denied**
   ```bash
   # Make scripts executable
   chmod +x scripts/backup-database.js scripts/export-users.js
   ```

4. **Empty backup files**
   - Check DATABASE_URL is correct
   - Verify database connection
   - Check PostgreSQL client version

5. **IPv6 connection issues (Network is unreachable)**
   ```bash
   # Use Supavisor connection string instead of direct connection
   # Get from: Supabase Dashboard > Settings > Database > Connection Pooling
   DATABASE_URL="postgresql://...@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
   
   # Check if IP is banned
   supabase network-bans get --project-ref <your-project-ref>
   ```

### Getting Help
- Check GitHub Actions logs for automated backups
- Run `npm run backup:db --help` for script help
- Check backup file sizes and timestamps

## 🔒 Security

- Database credentials are stored as GitHub Secrets
- Backup files are compressed and stored locally
- No sensitive data is logged in plain text
- Backup files should be stored securely

## 📅 Schedule

- **Daily**: 2:00 AM UTC (GitHub Actions)
- **Manual**: Anytime via `npm run backup:*`
- **Retention**: 30 days (GitHub Actions artifacts)

## ✅ Success Indicators

- ✅ Backup files created successfully
- ✅ Files are compressed (smaller size)
- ✅ Files have recent timestamps
- ✅ GitHub Actions show green status
- ✅ No error messages in logs

---

**Last Updated**: October 11, 2025  
**Backup System Version**: 1.0.0
