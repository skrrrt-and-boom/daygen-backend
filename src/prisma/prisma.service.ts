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
      console.warn('⚠️  DATABASE_URL not provided. Database features will be disabled.');
    }
    
    super({
      datasources: {
        db: {
          url: databaseUrl || 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
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
        console.error('❌ Failed to connect to database:', error.message);
        // Don't throw error, let the app start without database
      }
    } else {
      console.log('ℹ️  Skipping database connection (no DATABASE_URL provided)');
    }
  }
  
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
