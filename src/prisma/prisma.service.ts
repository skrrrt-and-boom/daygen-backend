import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.warn(
        '⚠️  DATABASE_URL not provided. Database features will be disabled.',
      );
    }

    // Check if using Supabase pooler or PgBouncer (port 6543 or pooler.supabase.com)
    const isUsingPooler = databaseUrl && (
      databaseUrl.includes(':6543/') || 
      databaseUrl.includes('pooler.supabase.com')
    );

    // Add pgbouncer=true parameter to disable prepared statements when using poolers
    let processedDatabaseUrl = databaseUrl;
    if (isUsingPooler && !databaseUrl.includes('pgbouncer=true')) {
      const separator = databaseUrl.includes('?') ? '&' : '?';
      processedDatabaseUrl = `${databaseUrl}${separator}pgbouncer=true`;
      console.log('🔧 Added pgbouncer=true to DATABASE_URL to disable prepared statements');
    }

    super({
      datasources: {
        db: {
          url:
            processedDatabaseUrl ||
            'postgresql://placeholder:placeholder@localhost:5432/placeholder',
        },
      },
      // Increase timeout for long-running operations
      transactionOptions: {
        maxWait: 30000, // 30 seconds
        timeout: 30000, // 30 seconds
      },
    });

    if (isUsingPooler) {
      console.log('🔧 Using connection pooler - prepared statements disabled via pgbouncer=true');
    }
  }

  async onModuleInit() {
    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
        console.log('✅ Database connected successfully');
      } catch (error) {
        console.error(
          '❌ Failed to connect to database:',
          (error as Error).message,
        );
        // Don't throw error, let the app start without database
      }
    } else {
      console.log(
        'ℹ️  Skipping database connection (no DATABASE_URL provided)',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
