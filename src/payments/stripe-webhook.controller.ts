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
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
    private readonly creditLedgerService: CreditLedgerService,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * Reports swallowed webhook errors with structured logging for monitoring/alerting.
   * These errors don't fail the webhook (to avoid blocking Stripe retries) but should
   * trigger alerts in production monitoring systems (Sentry, PagerDuty, etc.).
   */
  private reportSwallowedError(
    context: string,
    error: unknown,
    metadata: Record<string, unknown> = {},
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorCode = (error as { code?: string })?.code;

    // Structured error log that can be parsed by log aggregators
    this.logger.error({
      alert: 'WEBHOOK_HANDLER_ERROR',
      severity: 'HIGH',
      context,
      errorMessage,
      errorCode,
      errorStack,
      timestamp: new Date().toISOString(),
      ...metadata,
    });

    // Also log a human-readable version
    this.logger.error(
      `[ALERT] Webhook handler error in ${context}: ${errorMessage}`,
      errorStack,
    );
  }

  @Post()
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    // Performance tracking: request arrival
    const requestStartTime = Date.now();
    const requestArrivalTime = new Date().toISOString();

    this.logger.log(`Webhook received at ${requestArrivalTime} - checking signature`);

    if (!signature) {
      this.logger.error('Missing Stripe signature');
      const errorTime = Date.now() - requestStartTime;
      this.logger.log(`Webhook processing failed (no signature) in ${errorTime}ms`);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send('Missing Stripe signature');
    }

    this.logger.log(
      `Stripe signature present: ${signature.substring(0, 20)}...`,
    );

    try {
      // Performance tracking: signature verification start
      const signatureStartTime = Date.now();

      // Construct the event
      const event = this.stripeService.constructWebhookEvent(
        req.body as string | Buffer,
        signature,
      );

      // Performance tracking: signature verification complete
      const signatureVerificationTime = Date.now() - signatureStartTime;
      const totalTimeSoFar = Date.now() - requestStartTime;

      this.logger.log(
        `Received webhook event: ${event.type} (ID: ${event.id}) at ${new Date().toISOString()}`,
      );
      this.logger.log(
        `Webhook signature verification completed in ${signatureVerificationTime}ms (total: ${totalTimeSoFar}ms)`,
      );

      // Idempotency: persist event.id and skip duplicates
      const idempotencyStartTime = Date.now();
      let idempotencyCheckTime = 0;

      // Check if event already exists (safer than upsert with timestamp comparison)
      const existingEvent = await (this.prisma as any).webhookEvent.findUnique({
        where: { eventId: event.id },
      });

      if (existingEvent) {
        idempotencyCheckTime = Date.now() - idempotencyStartTime;
        const totalTime = Date.now() - requestStartTime;
        this.logger.log(`Duplicate webhook event ${event.id}; acknowledging`);
        this.logger.log(
          `Webhook duplicate check completed in ${idempotencyCheckTime}ms (total: ${totalTime}ms)`,
        );
        return res
          .status(HttpStatus.OK)
          .json({ received: true, duplicate: true });
      }

      // Create the event record (first time processing)
      try {
        await (this.prisma as any).webhookEvent.create({
          data: { eventId: event.id, type: event.type },
        });
      } catch (createError: any) {
        // Handle race condition - if another request created it first, treat as duplicate
        if (createError?.code === 'P2002') {
          idempotencyCheckTime = Date.now() - idempotencyStartTime;
          this.logger.log(`Duplicate webhook event ${event.id} (race condition); acknowledging`);
          return res
            .status(HttpStatus.OK)
            .json({ received: true, duplicate: true });
        }
        throw createError;
      }
      idempotencyCheckTime = Date.now() - idempotencyStartTime;

      this.logger.log(
        `Webhook idempotency check completed in ${idempotencyCheckTime}ms`,
      );

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.paid':
        case 'invoice.payment_succeeded': // backward compatibility
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      // Performance tracking: response ready
      const eventProcessingTime = Date.now() - requestStartTime;
      this.logger.log(`Successfully processed webhook event: ${event.type}`);
      this.logger.log(
        `Webhook processing completed in ${eventProcessingTime}ms (event: ${event.type}, id: ${event.id})`,
      );

      // Log performance metrics
      this.logger.log({
        event: 'webhook_performance',
        eventType: event.type,
        eventId: event.id,
        totalProcessingTime: eventProcessingTime,
        signatureVerificationTime,
        idempotencyCheckTime,
        requestArrivalTime,
        responseTime: new Date().toISOString(),
      });

      return res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      // Performance tracking: error occurred
      const errorProcessingTime = Date.now() - requestStartTime;
      this.logger.error('Webhook error:', error);
      this.logger.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
        processingTime: errorProcessingTime,
      });
      this.logger.log(
        `Webhook error occurred after ${errorProcessingTime}ms`,
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send(`Webhook Error: ${errorMessage}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    this.logger.log(
      `Processing checkout session completed: ${session.id} at ${new Date().toISOString()}`,
    );
    this.logger.log(`Session mode: ${session.mode}`);
    this.logger.log(`Session metadata:`, session.metadata);
    this.logger.log(
      `Session subscription ID: ${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
    );

    // Removed setImmediate wrapper. Processing directly.
    try {
      // Handle both one-time payments and subscriptions
      if (session.mode === 'payment') {
        this.logger.log(
          `Processing one-time payment for session ${session.id}`,
        );
        await this.creditLedgerService.handleSuccessfulPayment({
          ...session,
          payment_intent: typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id
        });
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
          // We need to use handleSuccessfulSubscription which now has the logic
          // Previously handleSuccessfulSubscriptionFromSession was called but it just delegated to handleSuccessfulSubscription in PaymentsService
          await this.subscriptionService.handleSuccessfulSubscription(
            subscription,
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
      if ((error).code) {
        this.logger.error(`Error code: ${(error).code}`);
      }
      if (error instanceof Error) {
        this.logger.error(`Error message: ${error.message}`);
      }
      throw error; // Rethrow to let the webhook handler catch it and log performance
    }
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
      await this.subscriptionService.handleSuccessfulSubscription(subscription);
      this.logger.log(`Successfully processed subscription ${subscription.id}`);
    } catch (error) {
      this.reportSwallowedError('handleSubscriptionCreated', error, {
        subscriptionId: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        status: subscription.status,
      });
      // Don't throw for background events to avoid 500ing the webhook if it's just a duplicate/race condition
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription updated: ${subscription.id}`);

    try {
      // Update subscription status in database
      await this.subscriptionService.updateSubscriptionStatus(subscription);
    } catch (error) {
      this.reportSwallowedError('handleSubscriptionUpdated', error, {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    this.logger.log(`Processing subscription deleted: ${subscription.id}`);

    try {
      // Mark subscription as cancelled in database
      await this.subscriptionService.cancelSubscriptionByStripeId(subscription.id);
    } catch (error) {
      this.reportSwallowedError('handleSubscriptionDeleted', error, {
        subscriptionId: subscription.id,
      });
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
        await this.subscriptionService.handleRecurringPayment(invoice);
        this.logger.log(`Successfully processed invoice ${invoice.id}`);
      } else {
        this.logger.log(`Invoice ${invoice.id} has no subscription, skipping`);
      }
    } catch (error) {
      this.reportSwallowedError('handleInvoicePaymentSucceeded', error, {
        invoiceId: invoice.id,
        subscriptionId: (invoice as any).subscription,
        amountPaid: (invoice as any).amount_paid,
      });
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
      await this.subscriptionService.handleFailedPayment(invoice);
      this.logger.log(`Successfully processed failed invoice ${invoice.id}`);
    } catch (error) {
      this.reportSwallowedError('handleInvoicePaymentFailed', error, {
        invoiceId: invoice.id,
        subscriptionId: (invoice as any).subscription,
        amountDue: (invoice as any).amount_due,
      });
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Processing payment intent failed: ${paymentIntent.id}`);

    try {
      // Find the payment record by payment intent ID
      const payment = await this.creditLedgerService.findPaymentByIntentId(
        paymentIntent.id,
      );

      if (payment) {
        // Update payment status to failed
        await this.creditLedgerService.updatePaymentStatus(payment.id, 'FAILED');

        this.logger.log(`Updated payment ${payment.id} status to FAILED`);
      } else {
        this.logger.warn(
          `No payment found for failed payment intent ${paymentIntent.id}`,
        );
      }
    } catch (error) {
      this.reportSwallowedError('handlePaymentIntentFailed', error, {
        paymentIntentId: paymentIntent.id,
      });
    }
  }
}
