import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { UsersService } from '../users/users.service';
import {
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  getCreditPackageById,
  getSubscriptionPlanById,
} from './credit-packages.config';
import type { SanitizedUser } from '../users/types';
import type {
  PaymentStatus,
  PaymentType,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';

export interface CreateCheckoutSessionDto {
  type: 'one_time' | 'subscription';
  packageId: string;
}

export interface PaymentHistoryItem {
  id: string;
  amount: number;
  credits: number;
  status: PaymentStatus;
  type: PaymentType;
  createdAt: Date;
  metadata?: any;
}

export interface SubscriptionInfo {
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  credits: number;
  createdAt: Date;
  stripePriceId: string;
  planId: string | null;
  planName: string | null;
  billingPeriod: 'monthly' | 'yearly';
}

type SessionStatusResult = {
  status: string;
  paymentStatus?: PaymentStatus;
  mode?: string;
  metadata?: any;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly usersService: UsersService,
  ) {}

  async createOneTimePurchaseSession(
    user: SanitizedUser,
    packageId: string,
  ): Promise<{ sessionId: string; url: string }> {
    const creditPackage = getCreditPackageById(packageId);
    if (!creditPackage) {
      throw new BadRequestException('Invalid credit package');
    }

    // For now, we'll use a hardcoded price ID. In production, you'd store these in the database
    const priceId = this.getPriceIdForPackage(creditPackage);

    const session = await this.stripeService.createCheckoutSession(
      user.authUserId,
      'one_time',
      priceId,
      {
        packageId,
        credits: creditPackage.credits.toString(),
        amount: creditPackage.price.toString(),
      },
    );

    // Create pending payment record
    await this.prisma.payment.create({
      data: {
        userId: user.authUserId,
        stripeSessionId: session.id,
        amount: creditPackage.price,
        credits: creditPackage.credits,
        status: 'PENDING',
        type: 'ONE_TIME',
        metadata: {
          packageId,
          packageName: creditPackage.name,
        },
      },
    });

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  async createSubscriptionSession(
    user: SanitizedUser,
    planId: string,
  ): Promise<{ sessionId: string; url: string }> {
    const subscriptionPlan = getSubscriptionPlanById(planId);
    if (!subscriptionPlan) {
      throw new BadRequestException('Invalid subscription plan');
    }

    // Check if user already has an active subscription
    const existingSubscription = await this.getUserSubscription(
      user.authUserId,
    );

    if (existingSubscription && existingSubscription.status === 'ACTIVE') {
      // Check if they're trying to subscribe to the same tier
      const currentPlan = SUBSCRIPTION_PLANS.find(
        (p) =>
          this.getPriceIdForSubscription(p) ===
          existingSubscription.stripePriceId,
      );

      if (currentPlan && currentPlan.id === planId) {
        throw new BadRequestException(
          'You already have this subscription plan. To upgrade or downgrade, please use the subscription management page.',
        );
      }

      // If different tier, redirect to upgrade/downgrade flow
      throw new BadRequestException(
        'You already have an active subscription. Please use the upgrade/downgrade option instead.',
      );
    }

    const priceId = this.getPriceIdForSubscription(subscriptionPlan);

    const session = await this.stripeService.createCheckoutSession(
      user.authUserId,
      'subscription',
      priceId,
      {
        planId,
        credits: subscriptionPlan.credits.toString(),
        amount: subscriptionPlan.price.toString(),
      },
    );

    // CREATE PENDING PAYMENT RECORD - THIS IS THE FIX
    // This ensures getSessionStatus() can find the payment record
    await this.prisma.payment.create({
      data: {
        userId: user.authUserId,
        stripeSessionId: session.id,
        amount: subscriptionPlan.price,
        credits: subscriptionPlan.credits,
        status: 'PENDING',
        type: 'SUBSCRIPTION',
        metadata: {
          planId,
          planName: subscriptionPlan.name,
          billingPeriod:
            subscriptionPlan.interval === 'year' ? 'yearly' : 'monthly',
        },
      },
    });

    this.logger.log(
      `Created pending payment record for subscription session ${session.id} for user ${user.authUserId}`,
    );

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  async handleSuccessfulPayment(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripeSessionId: session.id },
    });

    if (!payment) {
      this.logger.error(`Payment not found for session ${session.id}`);
      return;
    }

    if (payment.status === 'COMPLETED') {
      this.logger.warn(`Payment ${payment.id} already processed`);
      return;
    }

    // Update existing pending payment for this session
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        stripePaymentIntentId: session.payment_intent as string,
      },
    });

    // Add credits to user
    await this.addCreditsToUser(payment.userId, payment.credits, payment.id);

    this.logger.log(
      `Successfully processed payment ${payment.id} for user ${payment.userId}`,
    );
  }

  async createSubscriptionRecord(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const customerId = subscription.customer as string;
    const customer = await this.stripeService.retrieveCustomer(customerId);

    if (!customer.email) {
      this.logger.error(`Customer ${customerId} has no email`);
      return;
    }

    // Find user by email
    const user = await this.usersService.findByEmail(customer.email);
    if (!user) {
      this.logger.error(`User not found for email ${customer.email}`);
      return;
    }

    // Check if subscription already exists
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (existingSubscription) {
      this.logger.warn(`Subscription ${subscription.id} already exists`);
      return;
    }

    // Get subscription plan details
    const priceId = subscription.items.data[0]?.price.id;
    const plan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === priceId,
    );

    if (!plan) {
      this.logger.error(`Plan not found for price ID ${priceId}`);
      return;
    }

    // Create subscription record (without adding credits)
    await this.prisma.subscription.create({
      data: {
        userId: user.authUserId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: this.mapStripeStatusToDb(subscription.status),
        currentPeriodStart: new Date(
          ((subscription as any).current_period_start ||
            Math.floor(Date.now() / 1000)) * 1000,
        ),
        currentPeriodEnd: new Date(
          ((subscription as any).current_period_end ||
            Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
        ),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    this.logger.log(
      `Successfully created subscription record ${subscription.id} for user ${user.authUserId}`,
    );
  }

  async handleSuccessfulSubscriptionFromSession(
    subscription: Stripe.Subscription,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    try {
      this.logger.log(`🔄 Processing subscription ${subscription.id}`);
    
    // Get userId from session metadata instead of looking up by email
    const userId = session.metadata?.userId;
    console.log(`🔍 Looking for userId in session metadata:`, session.metadata);
    if (!userId) {
      console.error(`❌ No userId in session metadata for subscription ${subscription.id}`);
      this.logger.error(`❌ No userId in session metadata for subscription ${subscription.id}`);
      this.logger.error(`Available metadata keys:`, Object.keys(session.metadata || {}));
      return;
    }
    
    console.log(`✅ Found userId: ${userId}`);
    this.logger.log(`Found userId: ${userId}`);

    // Find user by authUserId
    console.log(`🔍 Looking up user with authUserId: ${userId}`);
    const user = await this.usersService.findByAuthUserId(userId);
    if (!user) {
      console.error(`❌ User not found for authUserId ${userId}`);
      this.logger.error(`❌ User not found for authUserId ${userId}`);
      return;
    }
    console.log(`✅ Found user: ${user.email}`);

    // Get subscription plan details
    const priceId = subscription.items.data[0]?.price.id;
    console.log(`🔍 Looking for plan with priceId: ${priceId}`);
    const plan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === priceId,
    );

    if (!plan) {
      console.error(`❌ Plan not found for price ID ${priceId}`);
      this.logger.error(`❌ Plan not found for price ID ${priceId}`);
      return;
    }

    console.log(`✅ Found plan: ${plan.name}, Credits: ${plan.credits}`);
    this.logger.log(`Plan: ${plan.name}, Credits: ${plan.credits}`);

    // Check if subscription already exists by Stripe ID
    const existingSubscriptionByStripeId =
      await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });

    if (existingSubscriptionByStripeId) {
      this.logger.warn(`Subscription ${subscription.id} already exists`);
      return;
    }

    // Check if user already has ANY subscription (handle upgrades)
    const existingUserSubscription = await this.prisma.subscription.findUnique({
      where: { userId: user.authUserId },
    });

    if (existingUserSubscription) {
      this.logger.warn(
        `User ${user.authUserId} already has subscription ${existingUserSubscription.id}. Upgrading instead.`,
      );
      return await this.upgradeExistingSubscription(
        existingUserSubscription,
        subscription,
        plan,
      );
    }

    // Create subscription; update existing pending payment instead of creating a duplicate
    await this.prisma.subscription.create({
      data: {
        userId: user.authUserId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: this.mapStripeStatusToDb(subscription.status),
        currentPeriodStart: new Date(
          ((subscription as any).current_period_start ||
            Math.floor(Date.now() / 1000)) * 1000,
        ),
        currentPeriodEnd: new Date(
          ((subscription as any).current_period_end ||
            Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
        ),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    // Verify payment status from Stripe before granting credits
    this.logger.log(`🔍 Verifying payment status...`);
    const paymentStatus = await this.verifySubscriptionPaymentStatus(subscription, session);
    
    if (!paymentStatus.isPaid) {
      this.logger.error(`❌ Payment not confirmed: ${paymentStatus.status} - ${paymentStatus.reason}`);
      return;
    }

    this.logger.log(`✅ Payment verified: ${paymentStatus.status}`);

    // Check if payment already exists (idempotency)
    let payment = await this.prisma.payment.findUnique({
      where: { stripeSessionId: session.id },
    });

    if (!payment) {
      // Create payment record for idempotency tracking
      payment = await this.prisma.payment.create({
        data: {
          userId: user.authUserId,
          stripeSessionId: session.id,
          amount: plan.price,
          credits: plan.credits,
          status: 'COMPLETED',
          type: 'SUBSCRIPTION',
          metadata: {
            planId: plan.id,
            planName: plan.name,
            stripeSubscriptionId: subscription.id,
            periodStart: (subscription as any).current_period_start,
            periodEnd: (subscription as any).current_period_end,
            source: 'checkout_session_completed',
            paymentVerification: paymentStatus,
          },
        },
      });
      console.log(`✅ Created new payment record: ${payment.id}`);
    } else {
      console.log(`♻️ Payment record already exists: ${payment.id}, status: ${payment.status}`);
    }

    // Grant credits to user only after payment verification
    console.log(`💰 Granting ${plan.credits} credits to user ${user.authUserId}`);
    await this.addCreditsToUser(user.authUserId, plan.credits, payment.id);
    this.logger.log(`🎉 SUCCESS: Granted ${plan.credits} credits to user ${user.authUserId}`);
    } catch (error) {
      console.error(`💥 ERROR in subscription processing:`, error);
      console.error(`💥 ERROR details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      this.logger.error(`💥 ERROR in subscription processing:`, error instanceof Error ? error.message : String(error));
      this.logger.error(`💥 ERROR stack:`, error instanceof Error ? error.stack : 'No stack trace');
      throw error;
    }
  }

  /**
   * Handle successful subscription creation from webhook (fallback method)
   * This method works without session metadata by finding the user from Stripe customer
   */
  async handleSuccessfulSubscription(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    this.logger.log(
      `Processing subscription ${subscription.id} without session metadata`,
    );

    try {
      // Get the customer from Stripe to find the user
      const customer = await this.stripeService.retrieveCustomer(
        subscription.customer as string,
      );
      this.logger.log(
        `Found customer ${customer.id} for subscription ${subscription.id}`,
      );

      // Find user by email or create a mapping
      const user = await this.findUserByStripeCustomerId(customer.id);
      if (!user) {
        this.logger.error(`No user found for Stripe customer ${customer.id}`);
        return;
      }

      // Get the price ID from the subscription
      const priceId = subscription.items.data[0]?.price.id;
      if (!priceId) {
        this.logger.error(
          `No price ID found in subscription ${subscription.id}`,
        );
        return;
      }

      // Find the plan by price ID
      const plan = this.getSubscriptionPlanByPriceId(priceId);
      if (!plan) {
        this.logger.error(`No plan found for price ID ${priceId}`);
        return;
      }

      // Check if subscription already exists
      const existingSubscription = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });

      if (existingSubscription) {
        this.logger.log(
          `Subscription ${subscription.id} already exists in database`,
        );
        return;
      }

      // Create subscription record
      await this.prisma.subscription.create({
        data: {
          userId: user.authUserId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          status: this.mapStripeStatusToDb(subscription.status),
          currentPeriodStart: new Date(
            ((subscription as any).current_period_start ||
              Math.floor(Date.now() / 1000)) * 1000,
          ),
          currentPeriodEnd: new Date(
            ((subscription as any).current_period_end ||
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
          ),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      });

      // Update payment record if it exists
      await this.prisma.payment.updateMany({
        where: {
          userId: user.authUserId,
          type: 'SUBSCRIPTION',
          status: 'PENDING',
        },
        data: { status: 'COMPLETED' },
      });

      // Add credits to user
      await this.addCreditsToUser(user.authUserId, plan.credits, null);

      this.logger.log(
        `Successfully processed subscription ${subscription.id} for user ${user.authUserId} with ${plan.credits} credits`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing subscription ${subscription.id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Find user by Stripe customer ID
   */
  private async findUserByStripeCustomerId(customerId: string): Promise<any> {
    // Try to find by email from Stripe customer
    try {
      const customer = await this.stripeService.retrieveCustomer(customerId);
      if (customer.email) {
        const userByEmail = await this.prisma.user.findUnique({
          where: { email: customer.email },
        });
        if (userByEmail) {
          return userByEmail;
        }
      }
    } catch (error) {
      this.logger.error(`Error retrieving customer ${customerId}:`, error);
    }

    return null;
  }

  /**
   * Get subscription plan by Stripe price ID
   */
  private getSubscriptionPlanByPriceId(priceId: string): any {
    // Map of price IDs to plan IDs
    const priceIdToPlanMap = {
      price_1QJ8XkzukLzUftDyG7MXiHje8ywj3XMklYv2og3IrLZfMml6TE5BXeTtn: 'pro', // Pro plan
      price_enterprise: 'enterprise', // Enterprise plan
      price_test_123: 'pro', // Test price ID
      // Add more price IDs as needed
    };

    const planId = priceIdToPlanMap[priceId];
    if (planId) {
      return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId);
    }

    // Fallback: try to match by price ID pattern or return default
    this.logger.warn(`Unknown price ID ${priceId}, using default Pro plan`);
    return SUBSCRIPTION_PLANS.find((plan) => plan.id === 'pro');
  }

  private async upgradeExistingSubscription(
    existingSubscription: any,
    newStripeSubscription: Stripe.Subscription,
    newPlan: any,
  ): Promise<void> {
    try {
      // Get the old plan to calculate credit difference
      const oldPlan = SUBSCRIPTION_PLANS.find(
        (p) =>
          p.id === existingSubscription.planId ||
          this.getPriceIdForSubscription(p) ===
            existingSubscription.stripePriceId,
      );

      const creditDifference = newPlan.credits - (oldPlan?.credits || 0);

      // Update the existing subscription with new Stripe details
      await this.prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          stripeSubscriptionId: newStripeSubscription.id,
          stripePriceId: newStripeSubscription.items.data[0]?.price.id,
          status: this.mapStripeStatusToDb(newStripeSubscription.status),
          currentPeriodStart: new Date(
            (newStripeSubscription as any).current_period_start * 1000,
          ),
          currentPeriodEnd: new Date(
            (newStripeSubscription as any).current_period_end * 1000,
          ),
          cancelAtPeriodEnd: newStripeSubscription.cancel_at_period_end,
        },
      });

      // Create payment record for the upgrade
      await this.prisma.payment.create({
        data: {
          userId: existingSubscription.userId,
          stripeSessionId: `upgrade_${newStripeSubscription.id}`,
          amount: newPlan.price,
          credits: creditDifference > 0 ? creditDifference : 0,
          status: 'COMPLETED',
          type: 'SUBSCRIPTION_UPGRADE',
          metadata: {
            planId: newPlan.id,
            planName: newPlan.name,
            stripeSubscriptionId: newStripeSubscription.id,
            previousPlanId: oldPlan?.id,
            previousPlanName: oldPlan?.name,
          },
        },
      });

      // Add credit difference if upgrading to higher tier
      if (creditDifference > 0) {
        await this.addCreditsToUser(
          existingSubscription.userId,
          creditDifference,
          null,
        );
        this.logger.log(
          `Upgraded subscription for user ${existingSubscription.userId} from ${oldPlan?.name || 'unknown'} to ${newPlan.name}. Added ${creditDifference} credits.`,
        );
      } else if (creditDifference < 0) {
        this.logger.log(
          `Downgraded subscription for user ${existingSubscription.userId} from ${oldPlan?.name || 'unknown'} to ${newPlan.name}. No credits added.`,
        );
      } else {
        this.logger.log(
          `Updated subscription for user ${existingSubscription.userId} to ${newPlan.name}. Same credit amount.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error upgrading subscription for user ${existingSubscription.userId}:`,
        error,
      );
      throw error;
    }
  }

  async addCreditsToUser(
    userId: string,
    credits: number,
    paymentId: string | null,
  ): Promise<void> {
    try {
      this.logger.log(`💰 Adding ${credits} credits to user ${userId}`);
      
      // Get current user credits before adding
      const userBefore = await this.prisma.user.findUnique({
        where: { authUserId: userId },
        select: { credits: true, email: true },
      });
      
      if (!userBefore) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Simple credit addition without complex SQL function
      const newBalance = userBefore.credits + credits;
      
      // Update user credits
      await this.prisma.user.update({
        where: { authUserId: userId },
        data: { credits: newBalance }
      });

      // Create ledger entry
      await this.prisma.creditLedger.create({
        data: {
          userId: userId,
          delta: credits,
          balanceAfter: newBalance,
          reason: 'PAYMENT',
          sourceType: 'PAYMENT',
          sourceId: paymentId,
          provider: 'stripe',
          model: 'payment',
          promptHash: null,
          metadata: JSON.stringify({ paymentId, type: 'credit_purchase' })
        }
      });

      this.logger.log(`✅ Credits added: ${userBefore.credits} → ${newBalance}`);
      
    } catch (error) {
      console.error(`💥 Error adding credits to user ${userId}:`, error);
      console.error(`💥 Credit error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      this.logger.error(`💥 Error adding credits to user ${userId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Verify that a subscription payment has been successfully processed
   * This method queries Stripe directly to check the current payment status
   */
  private async verifySubscriptionPaymentStatus(
    subscription: Stripe.Subscription,
    session: Stripe.Checkout.Session,
  ): Promise<{ isPaid: boolean; status: string; reason?: string }> {
    try {
      // Check subscription status first
      if (subscription.status !== 'active') {
        return {
          isPaid: false,
          status: subscription.status,
          reason: `Subscription status is ${subscription.status}, not active`,
        };
      }

      // Get the latest invoice for this subscription
      const invoices = await this.stripeService.getClient().invoices.list({
        subscription: subscription.id,
        limit: 1,
      });

      if (invoices.data.length === 0) {
        return {
          isPaid: false,
          status: 'no_invoice',
          reason: 'No invoice found for subscription',
        };
      }

      const latestInvoice = invoices.data[0];
      console.log(`🔍 Invoice details: id=${latestInvoice.id}, status=${latestInvoice.status}, paid=${(latestInvoice as any).paid}`);

      // Check if the invoice is paid - use status instead of paid property
      if (latestInvoice.status !== 'paid') {
        return {
          isPaid: false,
          status: latestInvoice.status || 'unpaid',
          reason: `Invoice ${latestInvoice.id} is not paid. Status: ${latestInvoice.status}`,
        };
      }

      // Additional check: verify the payment intent if available
      if ((latestInvoice as any).payment_intent) {
        const paymentIntent = await this.stripeService.getClient().paymentIntents.retrieve(
          (latestInvoice as any).payment_intent as string,
        );

        if (paymentIntent.status !== 'succeeded') {
          return {
            isPaid: false,
            status: paymentIntent.status,
            reason: `Payment intent ${paymentIntent.id} status is ${paymentIntent.status}`,
          };
        }
      }

      return {
        isPaid: true,
        status: 'paid',
      };
    } catch (error) {
      this.logger.error(
        `Error verifying payment status for subscription ${subscription.id}:`,
        error,
      );
      return {
        isPaid: false,
        status: 'verification_error',
        reason: `Failed to verify payment status: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async refundCredits(
    userId: string,
    credits: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'SELECT public.apply_credit_delta($1, $2, $3::"CreditReason", $4::"CreditSourceType", $5, $6, $7, $8, $9::jsonb)',
      userId,
      credits,
      'REFUND',
      'SYSTEM',
      null,
      'system',
      'refund',
      null,
      JSON.stringify({ type: 'credit_refund', reason }),
    );

    this.logger.log(
      `Refunded ${credits} credits to user ${userId} for reason: ${reason}`,
    );
  }

  async getUserPaymentHistory(
    userId: string,
    limit = 25,
  ): Promise<PaymentHistoryItem[]> {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      credits: payment.credits,
      status: payment.status,
      type: payment.type,
      createdAt: payment.createdAt,
      metadata: payment.metadata,
    }));
  }

  async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      return null;
    }

    // Find the plan details from the stripePriceId
    const plan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === subscription.stripePriceId,
    );

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      credits: plan?.credits ?? 0,
      createdAt: subscription.createdAt,
      stripePriceId: subscription.stripePriceId,
      planId: plan?.id || null,
      planName: plan?.name || null,
      billingPeriod: plan?.id?.includes('yearly') ? 'yearly' : 'monthly',
    };
  }

  async cancelUserSubscription(userId: string): Promise<void> {
    this.logger.log(`Attempting to cancel subscription for user ${userId}`);

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      this.logger.warn(`No subscription found for user ${userId}`);
      throw new NotFoundException('No active subscription found');
    }

    this.logger.log(
      `Found subscription ${subscription.id} for user ${userId}, status: ${subscription.status}`,
    );

    try {
      // Check if this is a test subscription or if Stripe subscription exists
      if (
        subscription.stripeSubscriptionId.startsWith('sub_test_') ||
        subscription.stripeSubscriptionId === 'sub_test_123'
      ) {
        this.logger.log(
          `Skipping Stripe cancellation for test subscription ${subscription.stripeSubscriptionId}`,
        );
      } else {
        // Cancel in Stripe
        await this.stripeService.cancelSubscription(
          subscription.stripeSubscriptionId,
        );
      }

      // Update local record regardless of Stripe status
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'CANCELLED',
          cancelAtPeriodEnd: true,
        },
      });

      this.logger.log(
        `Successfully cancelled subscription ${subscription.id} for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cancel subscription ${subscription.id} for user ${userId}:`,
        error,
      );

      // Even if Stripe cancellation fails, update local record
      try {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED',
            cancelAtPeriodEnd: true,
          },
        });
        this.logger.log(
          `Updated local subscription ${subscription.id} to cancelled despite Stripe error`,
        );
      } catch (dbError) {
        this.logger.error(
          `Failed to update local subscription ${subscription.id}:`,
          dbError,
        );
        throw error; // Re-throw original Stripe error
      }
    }
  }

  async removeCancellation(userId: string): Promise<void> {
    this.logger.log(`Attempting to remove cancellation for user ${userId}`);

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      this.logger.warn(`No subscription found for user ${userId}`);
      throw new NotFoundException('No active subscription found');
    }

    if (!subscription.cancelAtPeriodEnd) {
      this.logger.warn(
        `Subscription ${subscription.id} for user ${userId} is not cancelled`,
      );
      throw new BadRequestException('Subscription is not cancelled');
    }

    this.logger.log(
      `Found cancelled subscription ${subscription.id} for user ${userId}, status: ${subscription.status}`,
    );

    try {
      // Check if this is a test subscription or if Stripe subscription exists
      if (
        subscription.stripeSubscriptionId.startsWith('sub_test_') ||
        subscription.stripeSubscriptionId === 'sub_test_123'
      ) {
        this.logger.log(
          `Skipping Stripe cancellation removal for test subscription ${subscription.stripeSubscriptionId}`,
        );
      } else {
        // Remove cancellation in Stripe
        await this.stripeService.removeCancellation(
          subscription.stripeSubscriptionId,
        );
      }

      // Update local record regardless of Stripe status
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          cancelAtPeriodEnd: false,
        },
      });

      this.logger.log(
        `Successfully removed cancellation for subscription ${subscription.id} for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error removing cancellation for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  async upgradeSubscription(userId: string, newPlanId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only active subscriptions can be upgraded',
      );
    }

    const newPlan = getSubscriptionPlanById(newPlanId);
    if (!newPlan) {
      throw new BadRequestException('Invalid subscription plan');
    }

    const newPriceId = this.getPriceIdForSubscription(newPlan);

    // Check if it's actually an upgrade (higher price)
    const currentPlan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === subscription.stripePriceId,
    );

    if (!currentPlan) {
      throw new BadRequestException('Current plan not found');
    }

    const isUpgrade = newPlan.price > currentPlan.price;

    // Prepare metadata for Stripe
    const upgradeMetadata = {
      upgrade_from_plan: currentPlan.id,
      upgrade_to_plan: newPlan.id,
      upgraded_at: new Date().toISOString(),
      upgrade_type: isUpgrade ? 'upgrade' : 'downgrade',
    };

    // Check if this is a test subscription or if Stripe subscription exists
    if (
      subscription.stripeSubscriptionId.startsWith('sub_test_') ||
      subscription.stripeSubscriptionId === 'sub_test_123'
    ) {
      this.logger.log(
        `Skipping Stripe update for test subscription ${subscription.stripeSubscriptionId}`,
      );
    } else {
      // Update subscription in Stripe with metadata
      await this.stripeService.updateSubscription(
        subscription.stripeSubscriptionId,
        newPriceId,
        isUpgrade ? 'create_prorations' : 'none',
        upgradeMetadata,
      );
    }

    // Update local record
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        stripePriceId: newPriceId,
        // For downgrades, we don't change the period end date
        // For upgrades, Stripe handles proration automatically
      },
    });

    // Create payment history record for the upgrade
    await this.prisma.payment.create({
      data: {
        userId,
        amount: 0, // No immediate charge for upgrades
        credits: 0, // No credits added for upgrades
        status: 'COMPLETED',
        type: 'SUBSCRIPTION_UPGRADE',
        stripeSessionId: `upgrade_${subscription.id}_${Date.now()}`,
        metadata: {
          from_plan: currentPlan.name,
          to_plan: newPlan.name,
          from_plan_id: currentPlan.id,
          to_plan_id: newPlan.id,
          upgrade_type: isUpgrade ? 'upgrade' : 'downgrade',
          upgraded_at: new Date().toISOString(),
        },
      },
    });

    this.logger.log(
      `${isUpgrade ? 'Upgraded' : 'Downgraded'} subscription ${subscription.id} for user ${userId} to plan ${newPlanId}`,
    );
  }

  async getSessionStatus(
    sessionId: string,
  ): Promise<SessionStatusResult> {
    const session = await this.stripeService.retrieveSession(sessionId);

    const payment = await this.prisma.payment.findUnique({
      where: { stripeSessionId: sessionId },
    });

    const result: SessionStatusResult = {
      status: session.payment_status,
      paymentStatus: payment?.status || 'PENDING', // Default to PENDING if not found
      mode: session.mode,
    };

    // Add metadata for subscriptions
    if (session.mode === 'subscription' && payment?.metadata) {
      const metadata = payment.metadata as any; // Type assertion for metadata object
      result.metadata = {
        planName: metadata.planName,
        billingPeriod: metadata.billingPeriod || 'monthly',
        planId: metadata.planId,
      };
    }

    return result;
  }

  getCreditPackages() {
    return CREDIT_PACKAGES;
  }

  getSubscriptionPlans() {
    return SUBSCRIPTION_PLANS;
  }

  private getPriceIdForPackage(creditPackage: { id: string }): string {
    const priceIdMap: Record<string, string> = {
      test: process.env.STRIPE_TEST_PRICE_ID || '',
    };

    const priceId = priceIdMap[creditPackage.id];
    if (!priceId) {
      this.logger.error(
        `Price ID not configured for package: ${creditPackage.id}`,
      );
      throw new BadRequestException(
        `Price configuration missing for package: ${creditPackage.id}`,
      );
    }

    return priceId;
  }

  private getPriceIdForSubscription(plan: { id: string }): string {
    const priceIdMap: Record<string, string> = {
      // Monthly plans
      pro: process.env.STRIPE_PRO_PRICE_ID || '',
      enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
      // Yearly plans
      'pro-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
      'enterprise-yearly': process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '',
    };

    const priceId = priceIdMap[plan.id];
    if (!priceId) {
      this.logger.error(
        `Price ID not configured for subscription plan: ${plan.id}`,
      );
      throw new BadRequestException(
        `Price configuration missing for subscription plan: ${plan.id}`,
      );
    }

    return priceId;
  }

  async updateSubscriptionStatus(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: this.mapStripeStatusToDb(subscription.status),
        currentPeriodStart: new Date(
          ((subscription as any).current_period_start ||
            Math.floor(Date.now() / 1000)) * 1000,
        ),
        currentPeriodEnd: new Date(
          ((subscription as any).current_period_end ||
            Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
        ),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    this.logger.log(
      `Updated subscription ${subscription.id} status to ${subscription.status}`,
    );
  }

  async cancelSubscriptionByStripeId(
    stripeSubscriptionId: string,
  ): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId },
      data: {
        status: 'CANCELLED',
        cancelAtPeriodEnd: true,
      },
    });

    this.logger.log(`Cancelled subscription ${stripeSubscriptionId}`);
  }

  async handleRecurringPayment(invoice: Stripe.Invoice): Promise<void> {
    if (!(invoice as any).subscription) {
      return;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: (invoice as any).subscription as string },
    });

    if (!subscription) {
      this.logger.error(`Subscription not found for invoice ${invoice.id}`);
      return;
    }

    // Idempotency: if we already processed the invoice's payment intent, skip
    const paymentIntentId = (invoice as any).payment_intent as string | undefined;
    if (paymentIntentId) {
      const existing = await this.prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (existing) {
        this.logger.log(
          `Invoice ${invoice.id} already processed via payment ${existing.id}; skipping credit grant`,
        );
        return;
      }
    }

    // Check if this is the first invoice (already processed during checkout)
    const invoicePeriodStart = (invoice as any).period_start;
    const invoicePeriodEnd = (invoice as any).period_end;
    
    // Look for existing payment for this subscription with same period
    const existingPaymentByPeriod = await this.prisma.payment.findFirst({
      where: {
        userId: subscription.userId,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        metadata: {
          path: ['periodStart'],
          equals: invoicePeriodStart,
        },
      },
    });

    if (existingPaymentByPeriod) {
      this.logger.log(
        `First invoice for subscription ${subscription.id} already processed during checkout; skipping duplicate credit grant`,
      );
      return;
    }

    const plan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === subscription.stripePriceId,
    );
    const creditsToGrant = plan?.credits ?? 0;

    const payment = await this.prisma.payment.create({
      data: {
        userId: subscription.userId,
        stripePaymentIntentId: paymentIntentId || undefined,
        amount: Number((invoice as any).amount_paid || 0),
        credits: creditsToGrant,
        status: 'COMPLETED',
        type: 'SUBSCRIPTION',
        metadata: {
          invoiceId: invoice.id,
          periodStart: (invoice as any).period_start,
          periodEnd: (invoice as any).period_end,
        },
      },
    });

    // Create subscription cycle idempotently
    try {
      await (this.prisma as any).subscriptionCycle.create({
        data: {
          subscriptionId: subscription.id,
          stripeInvoiceId: invoice.id,
          periodStart: new Date(
            ((invoice as any).period_start || Math.floor(Date.now() / 1000)) *
              1000,
          ),
          periodEnd: new Date(
            ((invoice as any).period_end ||
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
          ),
          creditsGranted: creditsToGrant,
        },
      });
    } catch {
      // Unique violation means we already recorded this cycle
      this.logger.warn(
        `Subscription cycle for invoice ${invoice.id} already exists`,
      );
    }

    await this.addCreditsToUser(
      subscription.userId,
      creditsToGrant,
      payment.id,
    );

    this.logger.log(
      `Processed recurring payment for subscription ${subscription.id}`,
    );
  }

  async handleFailedPayment(invoice: Stripe.Invoice): Promise<void> {
    if (!(invoice as any).subscription) {
      return;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: (invoice as any).subscription as string },
    });

    if (!subscription) {
      this.logger.error(
        `Subscription not found for failed invoice ${invoice.id}`,
      );
      return;
    }

    // Check if we granted credits for this subscription and revoke them
    const payments = await this.prisma.payment.findMany({
      where: {
        userId: subscription.userId,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        metadata: {
          path: ['stripeSubscriptionId'],
          equals: subscription.stripeSubscriptionId,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Revoke credits from the most recent payment for this subscription
    if (payments.length > 0) {
      const latestPayment = payments[0];
      this.logger.log(
        `Revoking ${latestPayment.credits} credits from user ${subscription.userId} due to failed payment`,
      );

      // Use refundCredits to subtract the credits
      await this.refundCredits(
        subscription.userId,
        latestPayment.credits,
        `Payment failed for subscription ${subscription.stripeSubscriptionId}`,
      );

      // Mark the payment as failed
      await this.prisma.payment.update({
        where: { id: latestPayment.id },
        data: { status: 'FAILED' },
      });
    }

    // Update subscription status to past due
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'PAST_DUE' },
    });

    this.logger.log(
      `Marked subscription ${subscription.id} as past due due to failed payment`,
    );
  }

  async completeTestPayment(
    sessionId: string,
  ): Promise<{ message: string; paymentId?: string; subscriptionId?: string }> {
    console.log(`🚀 MANUAL PAYMENT COMPLETION STARTED for session: ${sessionId}`);
    this.logger.log(`🚀 MANUAL PAYMENT COMPLETION STARTED for session: ${sessionId}`);

    // Handle test sessions that don't exist in Stripe
    if (sessionId.startsWith('cs_test_') && sessionId.length > 20) {
      console.log(`🧪 Processing test session: ${sessionId}`);
      this.logger.log(`🧪 Processing test session: ${sessionId}`);
      
      try {
        // Find a test user to add credits to
        const testUser = await this.prisma.user.findFirst({
          where: {
            email: 'domin6051@gmail.com'
          }
        });

        if (!testUser) {
          throw new Error('Test user not found');
        }

        const creditsToAdd = 12000; // Pro plan credits
        const newBalance = testUser.credits + creditsToAdd;

        console.log(`💰 Adding ${creditsToAdd} credits to user ${testUser.email} (${testUser.credits} → ${newBalance})`);

        // Update user credits directly
        await this.prisma.user.update({
          where: { authUserId: testUser.authUserId },
          data: { credits: newBalance }
        });

        // Create payment record
        const payment = await this.prisma.payment.create({
          data: {
            userId: testUser.authUserId,
            stripeSessionId: sessionId,
            amount: 29000, // $290 in cents
            credits: creditsToAdd,
            status: 'COMPLETED',
            type: 'SUBSCRIPTION',
            metadata: {
              planId: 'pro-yearly',
              planName: 'Pro Yearly',
              testMode: true
            }
          }
        });

        // Create ledger entry
        await this.prisma.creditLedger.create({
          data: {
            userId: testUser.authUserId,
            delta: creditsToAdd,
            balanceAfter: newBalance,
            reason: 'PAYMENT',
            sourceType: 'PAYMENT',
            sourceId: payment.id,
            provider: 'stripe',
            model: 'payment',
            promptHash: null,
            metadata: JSON.stringify({ 
              sessionId, 
              type: 'test_payment_completion',
              testMode: true 
            })
          }
        });

        console.log(`✅ Test payment completed successfully! Added ${creditsToAdd} credits to ${testUser.email}`);
        this.logger.log(`✅ Test payment completed successfully! Added ${creditsToAdd} credits to ${testUser.email}`);

        return {
          message: `Test payment completed successfully! Added ${creditsToAdd} credits to ${testUser.email}`,
          paymentId: payment.id,
          subscriptionId: 'test-subscription'
        };

      } catch (error) {
        console.error(`💥 Error in test payment completion:`, error);
        this.logger.error(`💥 Error in test payment completion:`, error);
        throw error;
      }
    }

    try {
      // Get the Stripe session to determine the mode
      const session = await this.stripeService.retrieveSession(sessionId);
      console.log(`📊 Session details: mode=${session.mode}, status=${session.payment_status}, subscription=${session.subscription}`);
      this.logger.log(`📊 Session details: mode=${session.mode}, status=${session.payment_status}, subscription=${session.subscription}`);

      if (session.mode === 'subscription') {
        // Handle subscription payment
        if (session.subscription) {
          console.log(`🔄 Processing subscription: ${session.subscription}`);
          this.logger.log(`Processing subscription: ${session.subscription}`);

          // Retrieve the full subscription object
          const subscription = await this.stripeService.retrieveSubscription(
            session.subscription as string,
          );

          console.log(`📋 Retrieved subscription: ${subscription.id}, status: ${subscription.status}`);

          // Process the subscription using the existing method
          try {
            await this.handleSuccessfulSubscriptionFromSession(
              subscription,
              session,
            );
            console.log(`✅ Subscription ${subscription.id} completed manually`);
            this.logger.log(`✅ Subscription ${subscription.id} completed manually`);
          } catch (error) {
            console.error(`💥 Error processing subscription:`, error);
            this.logger.error(`💥 Error processing subscription:`, error);
            throw error; // Re-throw to return 500 error to frontend
          }

          return {
            message: 'Subscription completed manually',
            subscriptionId: subscription.id,
          };
        } else {
          console.error(`❌ No subscription found in session ${sessionId}`);
          this.logger.error(`No subscription found in session ${sessionId}`);
          return { message: 'No subscription found in session' };
        }
      } else if (session.mode === 'payment') {
        // Handle one-time payment
        const sessionStatus = await this.getSessionStatus(sessionId);
        if (sessionStatus.paymentStatus === 'PENDING') {
          // Find the payment and mark it as completed
          const payment = await this.prisma.payment.findUnique({
            where: { stripeSessionId: sessionId },
          });

          if (payment) {
            await this.prisma.payment.update({
              where: { id: payment.id },
              data: { status: 'COMPLETED' },
            });

            // Add credits to user
            await this.addCreditsToUser(
              payment.userId,
              payment.credits,
              payment.id,
            );

            this.logger.log(
              `Successfully processed payment ${payment.id} manually`,
            );
            return {
              message: 'Payment completed manually',
              paymentId: payment.id,
            };
          }
        }

        return { message: 'Payment not found or already completed' };
      } else {
        this.logger.error(`Unknown session mode: ${session.mode}`);
        return { message: `Unknown session mode: ${session.mode}` };
      }
    } catch (error) {
      this.logger.error(
        `Error completing test payment for session ${sessionId}:`,
        error,
      );
      this.logger.error(`Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      throw error;
    }
  }

  async findPaymentByIntentId(paymentIntentId: string) {
    return this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
  }

  async completePaymentByIntentId(
    paymentIntentId: string,
  ): Promise<{ message: string; paymentId?: string; subscriptionId?: string }> {
    this.logger.log(
      `Completing payment by Payment Intent ID: ${paymentIntentId}`,
    );

    try {
      // Find the payment by Payment Intent ID
      const payment = await this.prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (!payment) {
        this.logger.error(
          `No payment found for Payment Intent ID: ${paymentIntentId}`,
        );
        return { message: 'Payment not found for this Payment Intent ID' };
      }

      if (payment.status === 'COMPLETED') {
        this.logger.warn(`Payment ${payment.id} already completed`);
        return { message: 'Payment already completed' };
      }

      // Get the session to determine if it's a subscription
      const session = await this.stripeService.retrieveSession(
        payment.stripeSessionId!,
      );

      if (session.mode === 'subscription') {
        // Handle subscription payment
        if (session.subscription) {
          this.logger.log(
            `Processing subscription: ${typeof session.subscription === 'string' ? session.subscription : session.subscription.id}`,
          );

          // Retrieve the full subscription object
          const subscription = await this.stripeService.retrieveSubscription(
            session.subscription as string,
          );

          // Process the subscription using the existing method
          await this.handleSuccessfulSubscriptionFromSession(
            subscription,
            session,
          );

          this.logger.log(
            `Successfully processed subscription ${subscription.id} by Payment Intent`,
          );
          return {
            message: 'Subscription completed by Payment Intent',
            subscriptionId: subscription.id,
          };
        } else {
          this.logger.error(`No subscription found in session ${session.id}`);
          return { message: 'No subscription found in session' };
        }
      } else {
        // Handle one-time payment
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED' },
        });

        // Add credits to user
        await this.addCreditsToUser(
          payment.userId,
          payment.credits,
          payment.id,
        );

        this.logger.log(
          `Successfully processed payment ${payment.id} by Payment Intent`,
        );
        return {
          message: 'Payment completed by Payment Intent',
          paymentId: payment.id,
        };
      }
    } catch (error) {
      this.logger.error(
        `Error completing payment by Payment Intent ID ${paymentIntentId}:`,
        error,
      );
      throw error;
    }
  }

  async updatePaymentStatus(paymentId: string, status: PaymentStatus) {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status },
    });
  }

  async createManualSubscription(data: {
    userEmail: string;
    planId: string;
    credits: number;
    amount: number;
    paymentIntentId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
  }): Promise<{
    message: string;
    subscriptionId?: string;
    paymentId?: string;
  }> {
    this.logger.log(`Creating manual subscription for ${data.userEmail}`);

    try {
      // Find user by email
      const user = await this.usersService.findByEmail(data.userEmail);
      if (!user) {
        this.logger.error(`User not found for email ${data.userEmail}`);
        return { message: 'User not found for this email address' };
      }

      // Check if subscription already exists
      const existingSubscription = await this.prisma.subscription.findUnique({
        where: { userId: user.authUserId },
      });

      if (existingSubscription) {
        this.logger.warn(`User ${user.authUserId} already has a subscription`);
        return { message: 'User already has an active subscription' };
      }

      // Create subscription record
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: user.authUserId,
          stripeSubscriptionId: data.stripeSubscriptionId,
          stripePriceId: data.stripePriceId,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          cancelAtPeriodEnd: false,
        },
      });

      // Create payment record for tracking
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.authUserId,
          stripePaymentIntentId: data.paymentIntentId,
          amount: data.amount,
          credits: data.credits,
          status: 'COMPLETED',
          type: 'SUBSCRIPTION',
          metadata: {
            planId: data.planId,
            planName: data.planId === 'enterprise' ? 'Enterprise' : 'Pro',
            stripeSubscriptionId: data.stripeSubscriptionId,
            manual: true,
          },
        },
      });

      // Add credits to user
      await this.addCreditsToUser(user.authUserId, data.credits, payment.id);

      this.logger.log(
        `Successfully created manual subscription ${subscription.id} and added ${data.credits} credits for user ${user.authUserId}`,
      );

      return {
        message: 'Manual subscription created successfully',
        subscriptionId: subscription.id,
        paymentId: payment.id,
      };
    } catch (error) {
      this.logger.error(`Error creating manual subscription:`, error);
      throw error;
    }
  }

  private mapStripeStatusToDb(stripeStatus: string): SubscriptionStatus {
    const statusMap: Record<string, SubscriptionStatus> = {
      active: 'ACTIVE',
      canceled: 'CANCELLED',
      past_due: 'PAST_DUE',
      unpaid: 'UNPAID',
      incomplete: 'INCOMPLETE',
      incomplete_expired: 'INCOMPLETE_EXPIRED',
      trialing: 'TRIALING',
      paused: 'PAUSED',
    };

    return statusMap[stripeStatus] || 'ACTIVE';
  }

  async addCreditsDirectlyForTesting(sessionId: string): Promise<{ message: string; creditsAdded: number }> {
    console.log(`🧪 DIRECT CREDIT ADDITION for testing session: ${sessionId}`);
    this.logger.log(`🧪 DIRECT CREDIT ADDITION for testing session: ${sessionId}`);

    try {
      // Find a test user to add credits to
      const testUser = await this.prisma.user.findFirst({
        where: {
          email: 'domin6051@gmail.com'
        }
      });

      if (!testUser) {
        throw new Error('Test user not found');
      }

      const creditsToAdd = 1000; // Add 1000 credits for testing
      const newBalance = testUser.credits + creditsToAdd;

      console.log(`💰 Adding ${creditsToAdd} credits to user ${testUser.email} (${testUser.credits} → ${newBalance})`);

      // Update user credits
      await this.prisma.user.update({
        where: { authUserId: testUser.authUserId },
        data: { credits: newBalance }
      });

      // Skip ledger entry for now to isolate the issue
      console.log(`📝 Skipping ledger entry for now`);

      console.log(`✅ Successfully added ${creditsToAdd} credits to user ${testUser.email}`);
      this.logger.log(`✅ Successfully added ${creditsToAdd} credits to user ${testUser.email}`);

      return {
        message: `Test credits added successfully. Added ${creditsToAdd} credits to ${testUser.email}`,
        creditsAdded: creditsToAdd
      };

    } catch (error) {
      console.error(`💥 Error in direct credit addition:`, error);
      this.logger.error(`💥 Error in direct credit addition:`, error);
      throw error;
    }
  }
}
