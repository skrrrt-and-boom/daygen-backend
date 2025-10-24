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
    this.logger.log('Webhook received - checking signature');

    if (!signature) {
      this.logger.error('Missing Stripe signature');
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send('Missing Stripe signature');
    }

    this.logger.log(
      `Stripe signature present: ${signature.substring(0, 20)}...`,
    );

    try {
      // Construct the event
      const event = this.stripeService.constructWebhookEvent(
        req.body as string | Buffer,
        signature,
      );

      this.logger.log(
        `Received webhook event: ${event.type} (ID: ${event.id}) at ${new Date().toISOString()}`,
      );

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          this.handleCheckoutSessionCompleted(event.data.object);
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

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      this.logger.log(`Successfully processed webhook event: ${event.type}`);
      return res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      this.logger.error('Webhook error:', error);
      this.logger.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send(`Webhook Error: ${errorMessage}`);
    }
  }

  private handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    this.logger.log(
      `Processing checkout session completed: ${session.id} at ${new Date().toISOString()}`,
    );
    this.logger.log(`Session mode: ${session.mode}`);
    this.logger.log(`Session metadata:`, session.metadata);
    this.logger.log(
      `Session subscription ID: ${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
    );

    // Process in background for faster webhook response
    setImmediate(() => {
      void (async () => {
        try {
          // Handle both one-time payments and subscriptions
          if (session.mode === 'payment') {
            this.logger.log(
              `Processing one-time payment for session ${session.id}`,
            );
            await this.paymentsService.handleSuccessfulPayment(session);
          } else if (session.mode === 'subscription') {
            this.logger.log(
              `Processing subscription for session ${session.id}`,
            );
            // For subscriptions, we need to get the subscription object
            if (session.subscription) {
              this.logger.log(
                `Retrieving subscription ${typeof session.subscription === 'string' ? session.subscription : session.subscription.id} from Stripe`,
              );
              const subscription =
                await this.stripeService.retrieveSubscription(
                  session.subscription as string,
                );
              this.logger.log(
                `Retrieved subscription: ${subscription.id}, status: ${subscription.status}`,
              );
              // Handle subscription completion: create record AND add credits
              // Pass the session metadata to get the userId
              await this.paymentsService.handleSuccessfulSubscriptionFromSession(
                subscription,
                session,
              );
              this.logger.log(
                `Successfully processed subscription ${subscription.id}`,
              );
            } else {
              this.logger.error(
                `No subscription ID found in session ${session.id}`,
              );
            }
          } else {
            this.logger.warn(
              `Unknown session mode: ${session.mode} for session ${session.id}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing checkout session ${session.id}:`,
            error.stack || error,
          );
          // Log specific error details
          if (error.code) {
            this.logger.error(`Error code: ${error.code}`);
          }
          if (error.message) {
            this.logger.error(`Error message: ${error.message}`);
          }
        }
      })();
    });
  }

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription created: ${subscription.id}`);
    this.logger.log(`Subscription object:`, {
      id: subscription.id,
      status: subscription.status,
      current_period_start: (subscription as any).current_period_start,
      current_period_end: (subscription as any).current_period_end,
    });

    try {
      // Process subscription creation as a fallback if checkout.session.completed didn't handle it
      await this.paymentsService.handleSuccessfulSubscription(subscription);
      this.logger.log(`Successfully processed subscription ${subscription.id}`);
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
    this.logger.log(
      `Processing invoice payment succeeded: ${invoice.id} at ${new Date().toISOString()}`,
    );
    this.logger.log(`Invoice subscription: ${(invoice as any).subscription}`);
    this.logger.log(`Invoice amount: ${(invoice as any).amount_paid}`);

    try {
      // Handle recurring payment for subscription
      if ((invoice as any).subscription) {
        this.logger.log(
          `Processing recurring payment for subscription ${(invoice as any).subscription}`,
        );
        await this.paymentsService.handleRecurringPayment(invoice);
        this.logger.log(`Successfully processed invoice ${invoice.id}`);
      } else {
        this.logger.log(`Invoice ${invoice.id} has no subscription, skipping`);
      }
    } catch (error) {
      this.logger.error(
        `Error processing invoice payment ${invoice.id}:`,
        error,
      );
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.log(
      `Processing invoice payment failed: ${invoice.id} at ${new Date().toISOString()}`,
    );
    this.logger.log(`Invoice subscription: ${(invoice as any).subscription}`);
    this.logger.log(`Invoice amount: ${(invoice as any).amount_due}`);

    try {
      // Handle failed payment and revoke credits if they were granted
      await this.paymentsService.handleFailedPayment(invoice);
      this.logger.log(`Successfully processed failed invoice ${invoice.id}`);
    } catch (error) {
      this.logger.error(
        `Error processing failed payment ${invoice.id}:`,
        error,
      );
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Processing payment intent failed: ${paymentIntent.id}`);

    try {
      // Find the payment record by payment intent ID
      const payment = await this.paymentsService.findPaymentByIntentId(
        paymentIntent.id,
      );

      if (payment) {
        // Update payment status to failed
        await this.paymentsService.updatePaymentStatus(payment.id, 'FAILED');

        this.logger.log(`Updated payment ${payment.id} status to FAILED`);
      } else {
        this.logger.warn(
          `No payment found for failed payment intent ${paymentIntent.id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing failed payment intent ${paymentIntent.id}:`,
        error,
      );
    }
  }
}
