import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsTestController } from './payments-test.controller';
import { PublicPaymentsController } from './public-payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PlanConfigService } from './services/plan-config.service';
import { CreditLedgerService } from './services/credit-ledger.service';
import { SubscriptionService } from './services/subscription.service';
import { CheckoutSessionService } from './services/checkout-session.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [
    PaymentsController,
    PaymentsTestController,
    PublicPaymentsController,
    StripeWebhookController,
  ],
  providers: [
    StripeService,
    PaymentsService,
    PlanConfigService,
    CreditLedgerService,
    SubscriptionService,
    CheckoutSessionService,
  ],
  exports: [
    StripeService,
    PaymentsService,
    PlanConfigService,
    CreditLedgerService,
    SubscriptionService,
    CheckoutSessionService,
  ],
})
export class PaymentsModule { }
