import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Stripe as StripeType } from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: StripeType | null;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured - Stripe payments disabled');
      this.stripe = null;
      return;
    }

    this.stripe = new Stripe(secretKey, {
      // Use account default API version to avoid incompatibilities
      timeout: 15000,
      maxNetworkRetries: 2,
    });
  }

  private ensureStripeConfigured(): void {
    if (!this.stripe) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
    }
  }

  getClient(): StripeType {
    this.ensureStripeConfigured();
    return this.stripe!;
  }

  async createCheckoutSession(
    userId: string,
    type: 'one_time' | 'subscription',
    priceId: string,
    metadata: Record<string, string> = {},
    options?: { idempotencyKey?: string },
  ): Promise<StripeType.Checkout.Session> {
    // Environment-aware URL configuration
    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    // Use environment-specific URLs
    let baseUrl: string;
    if (nodeEnv === 'production') {
      baseUrl = frontendUrl || 'https://daygen.ai';
    } else {
      // Development environment - use localhost
      baseUrl = 'http://localhost:5173';
    }

    this.logger.log(
      `Creating checkout session with baseUrl: ${baseUrl} (NODE_ENV: ${nodeEnv})`,
    );
    this.logger.log(`Frontend URL from config: ${frontendUrl}`);
    this.logger.log(
      `Success URL will be: ${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    );

    // Map our types to Stripe modes
    const mode: StripeType.Checkout.SessionCreateParams.Mode =
      type === 'one_time' ? 'payment' : 'subscription';

    const sessionParams: StripeType.Checkout.SessionCreateParams = {
      mode,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment/cancel?type=${type}&package=${metadata.packageId || metadata.planId || 'unknown'}`,
      metadata: {
        userId,
        ...metadata,
      },
    };

    // Only add customer_creation for one-time payments, not subscriptions
    if (mode === 'payment') {
      sessionParams.customer_creation = 'always';
    }

    this.ensureStripeConfigured();
    try {
      // Deterministic idempotency unless overridden (e.g., to force a fresh session)
      const idempotencyKey =
        options?.idempotencyKey ||
        [userId, type, metadata.packageId || metadata.planId || 'na']
          .filter(Boolean)
          .join(':');
      const session = await this.stripe!.checkout.sessions.create(
        sessionParams,
        { idempotencyKey },
      );
      this.logger.log(
        `Created checkout session ${session.id} for user ${userId} with key: ${idempotencyKey}`,
      );
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create checkout session for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
  ): StripeType.Event {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    this.ensureStripeConfigured();
    try {
      return this.stripe!.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    } catch (error) {
      this.logger.error('Webhook signature verification failed:', error);
      throw error;
    }
  }

  async retrieveSession(
    sessionId: string,
  ): Promise<StripeType.Checkout.Session> {
    this.ensureStripeConfigured();
    try {
      return await this.stripe!.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      this.logger.error(`Failed to retrieve session ${sessionId}:`, error);
      throw error;
    }
  }

  async createCustomer(
    email: string,
    metadata: Record<string, string> = {},
  ): Promise<StripeType.Customer> {
    this.ensureStripeConfigured();
    try {
      const customerParams: StripeType.CustomerCreateParams = {
        email,
        metadata,
      };

      return await this.stripe!.customers.create(customerParams);
    } catch (error) {
      this.logger.error(`Failed to create customer for email ${email}:`, error);
      throw error;
    }
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<StripeType.Subscription> {
    this.ensureStripeConfigured();
    try {
      return await this.stripe!.subscriptions.cancel(subscriptionId);
    } catch (error) {
      this.logger.error(
        `Failed to cancel subscription ${subscriptionId}:`,
        error,
      );
      throw error;
    }
  }

  async removeCancellation(
    subscriptionId: string,
  ): Promise<StripeType.Subscription> {
    this.ensureStripeConfigured();
    try {
      return await this.stripe!.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to remove cancellation for subscription ${subscriptionId}:`,
        error,
      );
      throw error;
    }
  }

  async updateSubscription(
    subscriptionId: string,
    newPriceId: string,
    prorationBehavior: 'create_prorations' | 'none' = 'create_prorations',
    metadata?: Record<string, string>,
  ): Promise<StripeType.Subscription> {
    this.ensureStripeConfigured();
    try {
      // First, get the current subscription to find the subscription item
      const subscription =
        await this.stripe!.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = subscription.items.data[0]?.id;

      if (!subscriptionItemId) {
        throw new Error('No subscription item found');
      }

      // Update the subscription with the new price
      const updateParams: any = {
        items: [
          {
            id: subscriptionItemId,
            price: newPriceId,
          },
        ],
        proration_behavior: prorationBehavior,
      };

      // Add metadata if provided
      if (metadata) {
        updateParams.metadata = metadata;
      }

      return await this.stripe!.subscriptions.update(
        subscriptionId,
        updateParams,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update subscription ${subscriptionId}:`,
        error,
      );
      throw error;
    }
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<StripeType.Subscription> {
    this.ensureStripeConfigured();
    try {
      return await this.stripe!.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      this.logger.error(
        `Failed to retrieve subscription ${subscriptionId}:`,
        error,
      );
      throw error;
    }
  }

  async retrieveCustomer(customerId: string): Promise<StripeType.Customer> {
    this.ensureStripeConfigured();
    try {
      return (await this.stripe!.customers.retrieve(
        customerId,
      )) as StripeType.Customer;
    } catch (error) {
      this.logger.error(`Failed to retrieve customer ${customerId}:`, error);
      throw error;
    }
  }

  async listSubscriptions(
    customerId: string,
  ): Promise<StripeType.Subscription[]> {
    this.ensureStripeConfigured();
    try {
      const subscriptions = await this.stripe!.subscriptions.list({
        customer: customerId,
        status: 'all',
      });
      return subscriptions.data;
    } catch (error) {
      this.logger.error(
        `Failed to list subscriptions for customer ${customerId}:`,
        error,
      );
      throw error;
    }
  }

  async createUsageRecord(
    subscriptionItemId: string,
    quantity: number,
    idempotencyKey: string,
    timestamp?: Date,
  ): Promise<any> {
    this.ensureStripeConfigured();
    try {
      const params: any = {
        quantity,
        action: 'increment',
      } as any;
      if (timestamp) {
        // seconds since epoch
        (params).timestamp = Math.floor(timestamp.getTime() / 1000);
      }
      // Note: createUsageRecord returns a UsageRecord; summaries are listed separately
      return await (this.stripe! as any).subscriptionItems.createUsageRecord(
        subscriptionItemId,
        params,
        { idempotencyKey },
      );
    } catch (error) {
      this.logger.error(
        `Failed to create usage record for item ${subscriptionItemId}:`,
        error,
      );
      throw error;
    }
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<StripeType.BillingPortal.Session> {
    this.ensureStripeConfigured();
    try {
      // Typings may differ across Stripe versions
      return await (this.stripe! as any).billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create billing portal session for customer ${customerId}:`,
        error,
      );
      throw error;
    }
  }

  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<StripeType.BillingPortal.Session> {
    return this.createBillingPortalSession(customerId, returnUrl);
  }

  async resumeSubscription(
    subscriptionId: string,
  ): Promise<StripeType.Subscription> {
    return this.removeCancellation(subscriptionId);
  }
}
