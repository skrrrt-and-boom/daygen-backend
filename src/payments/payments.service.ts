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
}

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

    // Update payment status
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
          (subscription as any).current_period_start * 1000,
        ),
        currentPeriodEnd: new Date(
          (subscription as any).current_period_end * 1000,
        ),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        credits: plan.credits,
      },
    });

    this.logger.log(
      `Successfully created subscription record ${subscription.id} for user ${user.authUserId}`,
    );
  }

  async handleSuccessfulSubscription(
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

    // Get subscription plan details
    const priceId = subscription.items.data[0]?.price.id;
    const plan = SUBSCRIPTION_PLANS.find(
      (p) => this.getPriceIdForSubscription(p) === priceId,
    );

    if (!plan) {
      this.logger.error(`Plan not found for price ID ${priceId}`);
      return;
    }

    // Add credits to user (this is called from checkout.session.completed)
    await this.addCreditsToUser(user.authUserId, plan.credits, null);

    this.logger.log(
      `Successfully added ${plan.credits} credits for subscription ${subscription.id} to user ${user.authUserId}`,
    );
  }

  async addCreditsToUser(
    userId: string,
    credits: number,
    paymentId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Get current user credits
      const userRecord = await tx.user.findUnique({
        where: { authUserId: userId },
        select: { credits: true },
      });

      if (!userRecord) {
        throw new NotFoundException('User not found for credit addition');
      }

      const newBalance = userRecord.credits + credits;

      // Update user credits
      await tx.user.update({
        where: { authUserId: userId },
        data: {
          credits: newBalance,
        },
      });

      // Log the credit addition with correct balance
      await tx.usageEvent.create({
        data: {
          userAuthId: userId,
          provider: 'stripe',
          model: 'payment',
          prompt: `Added ${credits} credits`,
          cost: -credits, // Negative cost for credit addition
          balanceAfter: newBalance,
          status: 'COMPLETED',
          metadata: {
            paymentId,
            type: 'credit_purchase',
          },
        },
      });
    });

    this.logger.log(`Added ${credits} credits to user ${userId}`);
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

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      credits: subscription.credits,
      createdAt: subscription.createdAt,
    };
  }

  async cancelUserSubscription(userId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    // Cancel in Stripe
    await this.stripeService.cancelSubscription(
      subscription.stripeSubscriptionId,
    );

    // Update local record
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelAtPeriodEnd: true,
      },
    });

    this.logger.log(
      `Cancelled subscription ${subscription.id} for user ${userId}`,
    );
  }

  async getSessionStatus(
    sessionId: string,
  ): Promise<{ status: string; paymentStatus?: PaymentStatus }> {
    const session = await this.stripeService.retrieveSession(sessionId);

    const payment = await this.prisma.payment.findUnique({
      where: { stripeSessionId: sessionId },
    });

    return {
      status: session.payment_status,
      paymentStatus: payment?.status,
    };
  }

  getCreditPackages() {
    return CREDIT_PACKAGES;
  }

  getSubscriptionPlans() {
    return SUBSCRIPTION_PLANS;
  }

  private getPriceIdForPackage(creditPackage: any): string {
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

  private getPriceIdForSubscription(plan: any): string {
    const priceIdMap: Record<string, string> = {
      pro: process.env.STRIPE_PRO_PRICE_ID || '',
      enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
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
          (subscription as any).current_period_start * 1000,
        ),
        currentPeriodEnd: new Date(
          (subscription as any).current_period_end * 1000,
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

    // Add monthly credits to user
    await this.addCreditsToUser(
      subscription.userId,
      subscription.credits,
      null,
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
  ): Promise<{ message: string; paymentId?: string }> {
    // This is a test method to manually complete payments for development
    const session = await this.getSessionStatus(sessionId);
    if (session.paymentStatus === 'PENDING') {
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

        return { message: 'Payment completed manually', paymentId: payment.id };
      }
    }

    return { message: 'Payment not found or already completed' };
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
}
