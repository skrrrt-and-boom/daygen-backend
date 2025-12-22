import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StripeService } from './stripe.service';
import { SubscriptionService } from './services/subscription.service';
import { CreditLedgerService } from './services/credit-ledger.service';
import Stripe from 'stripe';

/**
 * Minimal Stripe Webhook Controller (~80 lines)
 * 
 * Processes webhooks inline - no queue overhead.
 * Idempotency is guaranteed by database constraints.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
    private readonly creditLedgerService: CreditLedgerService,
  ) { }

  @Post()
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    // 1. Validate signature
    if (!signature) {
      return res.status(HttpStatus.BAD_REQUEST).send('Missing signature');
    }

    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(req.body as Buffer, signature);
    } catch (err) {
      this.logger.error(`Signature verification failed: ${err}`);
      return res.status(HttpStatus.BAD_REQUEST).send('Invalid signature');
    }

    this.logger.log(`Processing ${event.type} (${event.id})`);

    // 2. Handle event inline
    try {
      await this.routeEvent(event);
    } catch (err) {
      this.logger.error(`Error processing ${event.id}: ${err}`);
      // Return 500 to trigger Stripe retry
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Processing failed');
    }

    return res.status(HttpStatus.OK).json({ received: true });
  }

  private async routeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
        await this.subscriptionService.handleSuccessfulSubscription(
          event.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.updated':
        await this.subscriptionService.updateSubscriptionStatus(
          event.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.deleted':
        await this.subscriptionService.cancelSubscriptionByStripeId(
          (event.data.object as Stripe.Subscription).id
        );
        break;

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        const invoice = event.data.object as Stripe.Invoice;
        if ((invoice as any).billing_reason === 'subscription_cycle') {
          await this.subscriptionService.handleRecurringPayment(invoice);
        }
        break;

      case 'invoice.payment_failed':
        await this.subscriptionService.handleFailedPayment(
          event.data.object as Stripe.Invoice
        );
        break;

      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'payment') {
          await this.creditLedgerService.handleSuccessfulPayment({
            ...session,
            payment_intent: typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id
          });
        }
        // Subscription mode handled by customer.subscription.created
        break;

      default:
        this.logger.log(`Unhandled: ${event.type}`);
    }
  }
}
