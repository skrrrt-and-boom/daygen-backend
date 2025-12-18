import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { StripeService } from './stripe.service';
import { PaymentsController } from './payments.controller'
import { StripeWebhookController } from './stripe-webhook.controller';
import { CreditLedgerService } from './services/credit-ledger.service';
import { SubscriptionService } from './services/subscription.service';
import { UserWalletService } from './services/user-wallet.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [
    PaymentsController,
    StripeWebhookController,
  ],
  providers: [
    StripeService,
    CreditLedgerService,
    SubscriptionService,
    UserWalletService,
  ],
  exports: [
    StripeService,
    CreditLedgerService,
    SubscriptionService,
    UserWalletService,
  ],
})
export class PaymentsModule { }

