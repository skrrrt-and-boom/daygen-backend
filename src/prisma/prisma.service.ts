import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
          if (!eu.searchParams.get('sslmode'))
            eu.searchParams.set('sslmode', 'require');
          if (!eu.searchParams.get('pgbouncer'))
            eu.searchParams.set('pgbouncer', 'true');
          if (!eu.searchParams.get('connection_limit'))
            eu.searchParams.set('connection_limit', '1');
          effectiveUrl = eu.toString();
        }
        const logUrl = new URL(effectiveUrl);
        console.log(
          `PrismaService: using db ${logUrl.hostname}:${logUrl.port || '5432'} (sslmode=${
            logUrl.searchParams.get('sslmode') || 'n/a'
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

    super({
      datasources: {
        db: {
          url:
            effectiveUrl ||
            'postgresql://placeholder:placeholder@localhost:5432/placeholder',
        },
      },
      // Increase timeout for long-running operations
      transactionOptions: {
        maxWait: 30000, // 30 seconds
        timeout: 30000, // 30 seconds
      },
    });
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
