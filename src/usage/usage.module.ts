import { Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageController } from './usage.controller';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, AuthModule, PaymentsModule],
  providers: [UsageService],
  controllers: [UsageController],
  exports: [UsageService],
})
export class UsageModule {}
