import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { 
  Stripe as StripeType
} from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: StripeType;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-09-30.clover',
    });
  }

  async createCheckoutSession(
    userId: string,
    type: 'one_time' | 'subscription',
    priceId: string,
    metadata: Record<string, string> = {}
  ): Promise<StripeType.Checkout.Session> {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    
    const sessionParams: StripeType.Checkout.SessionCreateParams = {
      mode: type as StripeType.Checkout.SessionCreateParams.Mode,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment/cancel`,
      metadata: {
        userId,
        ...metadata,
      },
    };

    // For subscriptions, add customer creation
    if (type === 'subscription') {
      sessionParams.customer_creation = 'always';
    }

    try {
      const session = await this.stripe.checkout.sessions.create(sessionParams);
      this.logger.log(`Created checkout session ${session.id} for user ${userId}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create checkout session for user ${userId}:`, error);
      throw error;
    }
  }

  async constructWebhookEvent(
    payload: string | Buffer,
    signature: string
  ): Promise<StripeType.Event> {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      this.logger.error('Webhook signature verification failed:', error);
      throw error;
    }
  }

  async retrieveSession(sessionId: string): Promise<StripeType.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      this.logger.error(`Failed to retrieve session ${sessionId}:`, error);
      throw error;
    }
  }

  async createCustomer(
    email: string,
    metadata: Record<string, string> = {}
  ): Promise<StripeType.Customer> {
    try {
      const customerParams: StripeType.CustomerCreateParams = {
        email,
        metadata,
      };

      return await this.stripe.customers.create(customerParams);
    } catch (error) {
      this.logger.error(`Failed to create customer for email ${email}:`, error);
      throw error;
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<StripeType.Subscription> {
    try {
      return await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      this.logger.error(`Failed to cancel subscription ${subscriptionId}:`, error);
      throw error;
    }
  }

  async retrieveSubscription(subscriptionId: string): Promise<StripeType.Subscription> {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      this.logger.error(`Failed to retrieve subscription ${subscriptionId}:`, error);
      throw error;
    }
  }

  async retrieveCustomer(customerId: string): Promise<StripeType.Customer> {
    try {
      return await this.stripe.customers.retrieve(customerId) as StripeType.Customer;
    } catch (error) {
      this.logger.error(`Failed to retrieve customer ${customerId}:`, error);
      throw error;
    }
  }

  async listSubscriptions(customerId: string): Promise<StripeType.Subscription[]> {
    try {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
      });
      return subscriptions.data;
    } catch (error) {
      this.logger.error(`Failed to list subscriptions for customer ${customerId}:`, error);
      throw error;
    }
  }
}
