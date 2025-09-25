import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
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
    await this.$connect();
  }
  
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
