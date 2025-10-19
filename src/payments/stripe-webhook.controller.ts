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
import { PaymentsService } from './payments.service';
import Stripe from 'stripe';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      this.logger.error('Missing Stripe signature');
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send('Missing Stripe signature');
    }

    try {
      // Construct the event
      const event = this.stripeService.constructWebhookEvent(
        req.body as string | Buffer,
        signature,
      );

      this.logger.log(`Received webhook event: ${event.type}`);

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      this.logger.error('Webhook error:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send(`Webhook Error: ${errorMessage}`);
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ) {
    this.logger.log(`Processing checkout session completed: ${session.id}`);

    try {
      // Handle both one-time payments and subscriptions
      if (session.mode === 'payment') {
        await this.paymentsService.handleSuccessfulPayment(session);
      } else if (session.mode === 'subscription') {
        // For subscriptions, we need to get the subscription object
        if (session.subscription) {
          const subscription = await this.stripeService.retrieveSubscription(
            session.subscription as string,
          );
          await this.paymentsService.handleSuccessfulSubscription(subscription);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error processing checkout session ${session.id}:`,
        error,
      );
    }
  }

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription created: ${subscription.id}`);

    try {
      // Only create subscription record, credits will be handled by checkout.session.completed
      await this.paymentsService.createSubscriptionRecord(subscription);
    } catch (error) {
      this.logger.error(
        `Error processing subscription ${subscription.id}:`,
        error,
      );
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription updated: ${subscription.id}`);

    try {
      // Update subscription status in database
      await this.paymentsService.updateSubscriptionStatus(subscription);
    } catch (error) {
      this.logger.error(
        `Error updating subscription ${subscription.id}:`,
        error,
      );
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription deleted: ${subscription.id}`);

    try {
      // Mark subscription as cancelled in database
      await this.paymentsService.cancelSubscriptionByStripeId(subscription.id);
    } catch (error) {
      this.logger.error(
        `Error cancelling subscription ${subscription.id}:`,
        error,
      );
    }
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    this.logger.log(`Processing invoice payment succeeded: ${invoice.id}`);

    try {
      // Handle recurring payment for subscription
      if ((invoice as any).subscription) {
        await this.paymentsService.handleRecurringPayment(invoice);
      }
    } catch (error) {
      this.logger.error(
        `Error processing invoice payment ${invoice.id}:`,
        error,
      );
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.log(`Processing invoice payment failed: ${invoice.id}`);

    try {
      // Handle failed payment
      await this.paymentsService.handleFailedPayment(invoice);
    } catch (error) {
      this.logger.error(
        `Error processing failed payment ${invoice.id}:`,
        error,
      );
    }
  }
}
