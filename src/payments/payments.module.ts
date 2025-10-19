import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [StripeService, PaymentsService],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
