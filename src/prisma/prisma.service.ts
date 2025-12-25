import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    // Respect DATABASE_URL, but if Supabase pooler is detected, ensure required params
    let effectiveUrl = databaseUrl;
    try {
      if (effectiveUrl) {
        const eu = new URL(effectiveUrl);
        const isSupabase = /supabase\.co$/i.test(eu.hostname);
        const port = Number(eu.port || '5432');
        if (isSupabase && (port === 6543 || port === 6532)) {
          if (!eu.searchParams.get('sslmode')) eu.searchParams.set('sslmode', 'require');
          if (!eu.searchParams.get('pgbouncer')) eu.searchParams.set('pgbouncer', 'true');
          if (!eu.searchParams.get('connection_limit')) eu.searchParams.set('connection_limit', '50');
          if (!eu.searchParams.get('pool_timeout')) eu.searchParams.set('pool_timeout', '30');
          effectiveUrl = eu.toString();
        }
        const logUrl = new URL(effectiveUrl);
        console.log(
          `PrismaService: using db ${logUrl.hostname}:${logUrl.port || '5432'} (sslmode=${logUrl.searchParams.get('sslmode') || 'n/a'
          }, pgbouncer=${logUrl.searchParams.get('pgbouncer') || 'n/a'})`,
        );
      }
    } catch {
      // Ignore URL parsing errors
    }

    if (!databaseUrl) {
      console.warn(
        '⚠️  DATABASE_URL not provided. Database features will be disabled.',
      );
    }

    // Use effectiveUrl if it was successfully processed, otherwise fall back to original databaseUrl
    let finalUrl: string | undefined = effectiveUrl || databaseUrl;

    // Check if using Supabase pooler or PgBouncer (port 6543 or pooler.supabase.com)
    const isUsingPooler = finalUrl && (
      finalUrl.includes(':6543/') ||
      finalUrl.includes('pooler.supabase.com')
    );

    // Add pgbouncer=true parameter to disable prepared statements when using poolers
    if (isUsingPooler && finalUrl && !finalUrl.includes('pgbouncer=true')) {
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}pgbouncer=true`;
      console.log('🔧 Added pgbouncer=true to DATABASE_URL to disable prepared statements');
    }

    super({
      datasources: {
        db: {
          url:
            finalUrl ||
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
