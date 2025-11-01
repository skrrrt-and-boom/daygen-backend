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

  // In-memory cache for session status with TTL
  private sessionCache = new Map<string, { data: any; expires: number }>();
  private readonly CACHE_TTL = 120 * 1000; // 120 seconds;

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
    this.logger.log(`🔍 Creating subscription session for planId: ${planId}`);

    // Plans now live in code only
    const subscriptionPlan = getSubscriptionPlanById(planId);

    if (!subscriptionPlan) {
      this.logger.error(`❌ Invalid subscription plan: ${planId}`);
      throw new BadRequestException('Invalid subscription plan');
    }

    this.logger.log(
      `📦 Resolved plan: ${subscriptionPlan.name}, ID: ${subscriptionPlan.id}, Credits: ${subscriptionPlan.credits}`,
    );

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

    this.logger.log(`💳 Using Stripe price ID: ${priceId}`);

    // Check for existing pending payment to avoid duplicate sessions
    const existingPending = await this.prisma.payment.findFirst({
      where: {
        userId: user.authUserId,
        type: 'SUBSCRIPTION',
        status: 'PENDING',
        metadata: {
          path: ['planId'],
          equals: planId,
        },
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending?.stripeSessionId) {
      try {
        const existingSession = await this.stripeService.retrieveSession(
          existingPending.stripeSessionId,
        );
        if (existingSession.status === 'open') {
          this.logger.log(`♻️ Reusing existing session: ${existingSession.id}`);
          return {
            sessionId: existingSession.id,
            url: existingSession.url!,
          };
        }
      } catch (error) {
        this.logger.warn('Existing session not found, creating new one');
      }
    }

    // Force a fresh session (avoid returning a closed/expired one from Stripe idempotency)
    const uniqueIdempotencyKey = `${user.authUserId}:subscription:${planId}:${Date.now()}`;
    const session = await this.stripeService.createCheckoutSession(
      user.authUserId,
      'subscription',
      priceId,
      {
        planId,
        credits: subscriptionPlan.credits.toString(),
        amount: (subscriptionPlan as any).price?.toString?.() || '0',
      },
      { idempotencyKey: uniqueIdempotencyKey },
    );

    // CREATE or UPDATE PENDING PAYMENT RECORD
    if (existingPending) {
      await this.prisma.payment.update({
        where: { id: existingPending.id },
        data: {
          stripeSessionId: session.id,
          amount: (subscriptionPlan as any).price || 0,
          credits: subscriptionPlan.credits,
          status: 'PENDING',
          metadata: Object.assign({}, (existingPending.metadata as any) || {}, {
            planId,
            planName: subscriptionPlan.name,
            billingPeriod:
              subscriptionPlan.interval === 'year' ? 'yearly' : 'monthly',
          }),
        },
      });
      this.logger.log(
        `🔁 Updated existing pending payment ${existingPending.id} for new session ${session.id}`,
      );
    } else {
      await this.prisma.payment.create({
        data: {
          userId: user.authUserId,
          stripeSessionId: session.id,
          amount: (subscriptionPlan as any).price || 0,
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
        `🆕 Created pending payment record for subscription session ${session.id} for user ${user.authUserId}`,
      );
    }

    return {
      sessionId: session.id,
      url: session.url!,
    };
  }

  async handleSuccessfulPayment(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
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

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          stripePaymentIntentId: session.payment_intent as string,
        },
      });

      await tx.user.update({
        where: { authUserId: payment.userId },
        data: { credits: { increment: payment.credits } },
      });
    });

    this.logger.log(`Successfully processed session ${session.id}`);
    this.invalidateSessionCache(session.id);
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

    // Get Stripe identifiers
    const priceId = subscription.items.data[0]?.price.id;
    const subscriptionItemId = subscription.items.data[0]?.id;

    // Persist Stripe customer mapping on user
    await this.prisma.user.update({
      where: { authUserId: user.authUserId },
      data: { stripeCustomerId: customer.id } as any,
    });

    // Create subscription record
    await this.prisma.subscription.create({
      data: {
        userId: user.authUserId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeSubscriptionItemId: subscriptionItemId,
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
        credits: 0,
      } as any,
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

      // Get userId from session metadata with customer ID fallback
      let userId = session.metadata?.userId;
      console.log(
        `🔍 Looking for userId in session metadata:`,
        session.metadata,
      );

      // FIX: Add customer ID fallback before aborting
      if (!userId) {
        this.logger.warn(
          `No userId in session metadata for subscription ${subscription.id}, attempting customer lookup fallback`,
        );
        const customerId = session.customer as string;
        if (customerId) {
          try {
            const customer =
              await this.stripeService.retrieveCustomer(customerId);
            if (customer.email) {
              const userByEmail = await this.usersService.findByEmail(
                customer.email,
              );
              if (userByEmail) {
                userId = userByEmail.authUserId;
                this.logger.log(
                  `✅ Recovered userId via customer lookup: ${userId}`,
                );
              }
            }
          } catch (error) {
            this.logger.error(
              `Failed to retrieve customer ${customerId}:`,
              error,
            );
          }
        }
      }

      if (!userId) {
        console.error(
          `❌ Cannot determine userId for subscription ${subscription.id}`,
        );
        this.logger.error(
          `❌ Cannot determine userId for subscription ${subscription.id}`,
        );
        this.logger.error(
          `Available metadata keys:`,
          Object.keys(session.metadata || {}),
        );
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

      // Capture Stripe price and item for metered billing
      const priceId = subscription.items.data[0]?.price.id;
      const subscriptionItemId = subscription.items.data[0]?.id;

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
      const existingUserSubscription =
        await this.prisma.subscription.findUnique({
          where: { userId: user.authUserId },
        });
      if (existingUserSubscription) {
        this.logger.warn(
          `User ${user.authUserId} already has subscription ${existingUserSubscription.id}. Upgrading instead.`,
        );
        // Resolve new plan based on current priceId and perform upgrade to set proper credits
        try {
          const newPlan = priceId ? await this.getPlanByStripePriceId(priceId) : null;
          if (newPlan) {
            await this.upgradeExistingSubscription(
              existingUserSubscription,
              subscription,
              newPlan,
            );
          } else {
            await this.updateSubscriptionStatus(subscription);
          }
        } catch (e) {
          this.logger.error(
            `Upgrade path failed for user ${user.authUserId}: ${(e as Error).message}`,
          );
          await this.updateSubscriptionStatus(subscription);
        }
        return;
      }

      // Fix 6: Use resolvePlanFromSessionOrPending pattern (same as completePaymentForUser)
      // This is more robust - checks pending payment metadata first, then session metadata, then code config
      let creditsToAdd = 0;
      let resolvedPlan: {
        planId: string;
        name: string;
        credits: number;
        amount: number;
        interval: 'month' | 'year';
        stripePriceId: string;
      } | null = null;

      try {
        resolvedPlan = await this.resolvePlanFromSessionOrPending(session.id);
        if (resolvedPlan) {
          creditsToAdd = resolvedPlan.credits;
          this.logger.log(
            `💰 Resolved plan from session/pending: ${resolvedPlan.name} (${resolvedPlan.planId}) - ${creditsToAdd} credits`,
          );
        } else {
          this.logger.warn(
            `⚠️ Could not resolve plan from session/pending for session ${session.id}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `⚠️ Error resolving plan from session/pending: ${(error as Error).message}, falling back to priceId lookup`,
        );
        // Fallback to direct priceId lookup if resolvePlanFromSessionOrPending fails
        if (priceId) {
          const plan = await this.getPlanByStripePriceId(priceId);
          if (plan) {
            creditsToAdd = plan.credits;
            this.logger.log(
              `💰 Fallback: Resolved plan credits for priceId ${priceId}: ${creditsToAdd} credits`,
            );
          }
        }
      }

      if (creditsToAdd === 0) {
        this.logger.warn(
          `⚠️ Credits still 0 after plan resolution. PriceId: ${priceId}, Session: ${session.id}`,
        );
      }

      // Verify payment status from Stripe before any DB writes
      this.logger.log(`🔍 Verifying payment status...`);
      const paymentStatus = await this.verifySubscriptionPaymentStatus(
        subscription,
        session,
      );
      if (!paymentStatus.isPaid) {
        this.logger.error(
          `❌ Payment not confirmed: ${paymentStatus.status} - ${paymentStatus.reason}`,
        );
        return;
      }

      this.logger.log(`✅ Payment verified: ${paymentStatus.status}`);

      // Perform all DB writes atomically
      await this.prisma.$transaction(async (tx) => {
        // Persist Stripe customer ID on user (if available)
        if (session.customer) {
          try {
            await tx.user.update({
              where: { authUserId: user.authUserId },
              data: { stripeCustomerId: session.customer as string } as any,
            });
          } catch {}
        }

        // Fetch actual price from Stripe (for audit only)
        let actualAmount = 0;
        try {
          const priceDetails = await this.stripeService
            .getClient()
            .prices.retrieve(priceId);
          actualAmount = priceDetails.unit_amount || 0;
        } catch (error) {
          this.logger.warn(`Failed to fetch price details: ${error}, using 0`);
        }

        // Update existing pending payment (preferred) or create one if missing
        const existingPayment = await tx.payment.findUnique({
          where: { stripeSessionId: session.id },
        });

        if (existingPayment?.status === 'COMPLETED') {
          this.logger.log(
            `Payment ${existingPayment.id} already completed, skipping DB writes`,
          );
          return;
        }

        if (existingPayment) {
          await tx.payment.update({
            where: { id: existingPayment.id },
            data: {
              status: 'COMPLETED',
              amount: actualAmount,
              credits: creditsToAdd,
              stripePaymentIntentId: session.payment_intent as string,
              metadata: {
                ...(existingPayment.metadata as any),
                source: 'checkout_session_completed',
                stripeSubscriptionId: subscription.id,
                periodStart: (subscription as any).current_period_start,
                periodEnd: (subscription as any).current_period_end,
                paymentVerification: paymentStatus,
              },
            },
          });
        } else {
          await tx.payment.create({
            data: {
              userId: user.authUserId,
              stripeSessionId: session.id,
              amount: actualAmount,
              credits: creditsToAdd,
              status: 'COMPLETED',
              type: 'SUBSCRIPTION',
              metadata: {
                source: 'checkout_session_completed',
                stripeSubscriptionId: subscription.id,
                periodStart: (subscription as any).current_period_start,
                periodEnd: (subscription as any).current_period_end,
                paymentVerification: paymentStatus,
              },
            },
          });
        }

        // Upsert subscription by userId to avoid races; ensure credits are set
        await tx.subscription.upsert({
          where: { userId: user.authUserId },
          update: {
            stripeSubscriptionId: subscription.id,
            stripePriceId: (resolvedPlan?.stripePriceId || priceId) as string,
            stripeSubscriptionItemId: subscriptionItemId,
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
            credits: creditsToAdd,
          },
          create: {
            userId: user.authUserId,
            stripeSubscriptionId: subscription.id,
            stripePriceId: (resolvedPlan?.stripePriceId || priceId) as string,
            stripeSubscriptionItemId: subscriptionItemId,
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
            credits: creditsToAdd,
          },
        });

        // Increment user credits when subscription is confirmed
        if (creditsToAdd > 0) {
          await tx.user.update({
            where: { authUserId: user.authUserId },
            data: { credits: { increment: creditsToAdd } },
          });
        }
      });

      // Invalidate session cache since payment status changed
      this.invalidateSessionCache(session.id);
    } catch (error) {
      console.error(`💥 ERROR in subscription processing:`, error);
      this.logger.error(
        `Error in subscription processing: ${error?.message || error}`,
      );
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

      // Metered billing: no plan-based credits needed

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

      // Persist Stripe customer ID on user
      await this.prisma.user.update({
        where: { authUserId: user.authUserId },
        data: { stripeCustomerId: customer.id } as any,
      });

      // Create or update subscription record with resolved credits
      const fallbackPlan = priceId ? await this.getPlanByStripePriceId(priceId) : null;
      const fallbackCredits = fallbackPlan?.credits || 0;
      await this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        update: {
          userId: user.authUserId,
          stripePriceId: priceId || undefined,
          stripeSubscriptionItemId: subscription.items.data[0]?.id,
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
          credits: fallbackCredits,
        },
        create: {
          userId: user.authUserId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId || '',
          stripeSubscriptionItemId: subscription.items.data[0]?.id,
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
          credits: fallbackCredits,
        },
      });

      // FIX: Update specific payment record if it exists (not all pending payments)
      // Find the payment associated with this subscription
      const subscriptionPayment = await this.prisma.payment.findFirst({
        where: {
          userId: user.authUserId,
          type: 'SUBSCRIPTION',
          status: 'PENDING',
          metadata: {
            path: ['stripeSubscriptionId'],
            equals: subscription.id,
          },
        },
      });

      if (subscriptionPayment) {
        await this.prisma.payment.update({
          where: { id: subscriptionPayment.id },
          data: { status: 'COMPLETED' },
        });
        this.logger.log(
          `Updated payment ${subscriptionPayment.id} for subscription ${subscription.id}`,
        );
      }

      // Metered billing: no credit grants here
      this.logger.log(
        `Successfully processed subscription ${subscription.id} for user ${user.authUserId}`,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _paymentId: string | null,
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
        data: { credits: newBalance },
      });

      // Ledger entry removed - no longer needed

      this.logger.log(
        `✅ Credits added: ${userBefore.credits} → ${newBalance}`,
      );
    } catch (error) {
      console.error(`💥 Error adding credits to user ${userId}:`, error);
      console.error(`💥 Credit error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      this.logger.error(
        `💥 Error adding credits to user ${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify that a subscription payment has been successfully processed
   * This method queries Stripe directly to check the current payment status
   */
  private async verifySubscriptionPaymentStatus(
    subscription: Stripe.Subscription,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _session: Stripe.Checkout.Session,
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
      console.log(
        `🔍 Invoice details: id=${latestInvoice.id}, status=${latestInvoice.status}, paid=${(latestInvoice as any).paid}`,
      );

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
        const paymentIntent = await this.stripeService
          .getClient()
          .paymentIntents.retrieve(
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
    // FIX: Standardize to use direct Prisma operation (consistent with addCreditsToUser)
    const user = await this.prisma.user.findUnique({
      where: { authUserId: userId },
      select: { credits: true, email: true },
    });

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // Simple credit refund using direct update (consistent with addCreditsToUser)
    const newBalance = user.credits - credits;

    await this.prisma.user.update({
      where: { authUserId: userId },
      data: { credits: newBalance },
    });

    this.logger.log(
      `Refunded ${credits} credits: ${user.credits} → ${newBalance} for reason: ${reason}`,
    );
  }

  async getUserPaymentHistory(
    userId: string,
    limit = 25,
  ): Promise<PaymentHistoryItem[]> {
    try {
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
    } catch (error) {
      this.logger.error(
        `Error fetching payment history for user ${userId}:`,
        error,
      );
      // Return empty array for users with no payment history
      return [];
    }
  }

  async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { userId },
      });

      if (!subscription) {
        return null;
      }

      // Log diagnostic information
      this.logger.log(`Getting subscription for user ${userId}`);
      this.logger.log(`Database stripePriceId: ${subscription.stripePriceId}`);

      // Log all environment price IDs for comparison
      const envPriceIds = {
        STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
        STRIPE_ENTERPRISE_PRICE_ID: process.env.STRIPE_ENTERPRISE_PRICE_ID,
        STRIPE_PRO_YEARLY_PRICE_ID: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
        STRIPE_ENTERPRISE_YEARLY_PRICE_ID:
          process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID,
      };
      this.logger.log('Environment price IDs:', envPriceIds);

      // Find the plan details from the stripePriceId using reverse lookup
      const plan = await this.getPlanByStripePriceId(
        subscription.stripePriceId,
      );

      if (!plan) {
        this.logger.error(
          `Plan not found for stripePriceId: ${subscription.stripePriceId}`,
        );
        this.logger.error('Available price IDs from environment:');
        this.logger.error(
          `  STRIPE_PRO_PRICE_ID: ${process.env.STRIPE_PRO_PRICE_ID}`,
        );
        this.logger.error(
          `  STRIPE_ENTERPRISE_PRICE_ID: ${process.env.STRIPE_ENTERPRISE_PRICE_ID}`,
        );
        this.logger.error(
          `  STRIPE_PRO_YEARLY_PRICE_ID: ${process.env.STRIPE_PRO_YEARLY_PRICE_ID}`,
        );
        this.logger.error(
          `  STRIPE_ENTERPRISE_YEARLY_PRICE_ID: ${process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID}`,
        );
      } else {
        this.logger.log(
          `Found plan: ${plan.id} (${plan.name}) with ${plan.credits} credits`,
        );
      }

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
    } catch (error) {
      this.logger.error(
        `Error fetching subscription for user ${userId}:`,
        error,
      );
      // Return null on error to gracefully handle users without subscriptions
      return null;
    }
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

  async getSessionStatus(sessionId: string): Promise<SessionStatusResult> {
    // Check cache first
    const cached = this.sessionCache.get(sessionId);
    if (cached && cached.expires > Date.now()) {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`📦 Using cached session data for ${sessionId}`);
      }
      return cached.data;
    }

    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`🌐 Fetching fresh session data for ${sessionId}`);
    }

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

    // Cache the result
    this.sessionCache.set(sessionId, {
      data: result,
      expires: Date.now() + this.CACHE_TTL,
    });

    return result;
  }

  /**
   * Get session status from database only (fast path)
   */
  async getSessionStatusQuick(sessionId: string): Promise<SessionStatusResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { stripeSessionId: sessionId },
    });

    if (!payment) {
      return {
        status: 'unknown',
        paymentStatus: 'PENDING',
        mode: 'unknown',
      };
    }

    return {
      status: payment.status === 'COMPLETED' ? 'paid' : 'unpaid',
      paymentStatus: payment.status,
      mode: payment.type === 'SUBSCRIPTION' ? 'subscription' : 'payment',
      metadata: payment.metadata as any,
    };
  }

  /**
   * Invalidate session cache (call when payment is completed)
   */
  private invalidateSessionCache(sessionId: string): void {
    this.sessionCache.delete(sessionId);
    console.log(`🗑️ Invalidated cache for session ${sessionId}`);
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

    // CRITICAL: Log environment variables for debugging
    this.logger.log(`🔑 Environment variables for plan ${plan.id}:`);
    this.logger.log(
      `   STRIPE_PRO_PRICE_ID: ${process.env.STRIPE_PRO_PRICE_ID || 'NOT SET'}`,
    );
    this.logger.log(
      `   STRIPE_ENTERPRISE_PRICE_ID: ${process.env.STRIPE_ENTERPRISE_PRICE_ID || 'NOT SET'}`,
    );
    this.logger.log(
      `   STRIPE_PRO_YEARLY_PRICE_ID: ${process.env.STRIPE_PRO_YEARLY_PRICE_ID || 'NOT SET'}`,
    );
    this.logger.log(
      `   STRIPE_ENTERPRISE_YEARLY_PRICE_ID: ${process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || 'NOT SET'}`,
    );
    this.logger.log(
      `   Resolved priceId for ${plan.id}: ${priceId || 'MISSING'}`,
    );

    if (!priceId || priceId === '') {
      this.logger.error(
        `Price ID not configured for subscription plan: ${plan.id}`,
      );
      throw new BadRequestException(
        `Price configuration missing for subscription plan: ${plan.id}. Please check environment variables.`,
      );
    }

    return priceId;
  }

  private async getPlanByStripePriceId(stripePriceId: string): Promise<{
    id: string;
    name: string;
    credits: number;
    price?: number;
    interval: 'month' | 'year';
  } | null> {
    // Fix 4: First try Plan table from database
    try {
      const dbPlan = await (this.prisma as any).plan?.findUnique({
        where: { stripePriceId },
      });
      if (dbPlan) {
        this.logger.log(
          `✅ Found plan in database for priceId ${stripePriceId}: ${dbPlan.name} (${dbPlan.creditsPerPeriod} credits)`,
        );
        return {
          id: dbPlan.code || stripePriceId,
          name: dbPlan.name,
          credits: dbPlan.creditsPerPeriod,
          interval: (dbPlan.interval as 'month' | 'year') || 'month',
        };
      }
    } catch (error) {
      // Plan table might not exist or not accessible, fallback to code config
      this.logger.debug(
        `Plan table lookup failed for ${stripePriceId}, falling back to code config: ${(error as Error).message}`,
      );
    }

    // Fallback: Plans live in code/env mapping
    const reversePriceIdMap: Record<string, string> = {
      [process.env.STRIPE_PRO_PRICE_ID || '']: 'pro',
      [process.env.STRIPE_ENTERPRISE_PRICE_ID || '']: 'enterprise',
      [process.env.STRIPE_PRO_YEARLY_PRICE_ID || '']: 'pro-yearly',
      [process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '']:
        'enterprise-yearly',
    };
    let planId = reversePriceIdMap[stripePriceId];
    if (!planId) {
      const placeholderMap: Record<string, string> = {
        price_pro: 'pro',
        price_enterprise: 'enterprise',
        price_pro_yearly: 'pro-yearly',
        price_enterprise_yearly: 'enterprise-yearly',
        pro: 'pro',
        enterprise: 'enterprise',
        'pro-yearly': 'pro-yearly',
        'enterprise-yearly': 'enterprise-yearly',
      };
      planId = placeholderMap[stripePriceId];
    }
    if (!planId) return null;
    const legacy = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
    return legacy
      ? {
          id: legacy.id,
          name: legacy.name,
          credits: legacy.credits,
          price: legacy.price,
          interval: legacy.interval,
        }
      : null;
  }

  /**
   * Resolve plan selection and price for a checkout session from our DB or Stripe
   */
  private async resolvePlanFromSessionOrPending(sessionId: string): Promise<{
    planId: string;
    name: string;
    credits: number;
    amount: number;
    interval: 'month' | 'year';
    stripePriceId: string;
  }> {
    // 1) Prefer our pending payment record (authoritative for chosen plan)
    const pending = await this.prisma.payment.findUnique({
      where: { stripeSessionId: sessionId },
    });

    const normalizePlanId = (rawPlanId: string, billingPeriod?: string) => {
      if (!rawPlanId) return rawPlanId;
      const isYearly =
        billingPeriod === 'yearly' || rawPlanId.includes('yearly');
      if (isYearly && !rawPlanId.endsWith('-yearly')) {
        return `${rawPlanId}-yearly`;
      }
      return rawPlanId;
    };

    const pendingMeta =
      pending &&
      typeof pending.metadata === 'object' &&
      pending.metadata !== null &&
      !Array.isArray(pending.metadata)
        ? (pending.metadata as Record<string, any>)
        : undefined;

    if (pending?.type === 'SUBSCRIPTION' && pendingMeta && pendingMeta.planId) {
      const normalizedPlanId = normalizePlanId(
        pendingMeta.planId as string,
        pendingMeta.billingPeriod as string | undefined,
      );
      const plan = getSubscriptionPlanById(normalizedPlanId);
      if (!plan) {
        throw new BadRequestException(
          `Could not resolve plan ${normalizedPlanId} from pending payment metadata`,
        );
      }
      const stripePriceId = this.getPriceIdForSubscription(plan);
      this.logger.log(
        `🧭 Resolved plan from pending payment: ${plan.id} (${plan.name}), interval=${plan.interval}, priceId=${stripePriceId}`,
      );
      return {
        planId: plan.id,
        name: plan.name,
        credits: plan.credits,
        amount: plan.price,
        interval: plan.interval,
        stripePriceId,
      };
    }

    // 2) Fallback to Stripe session metadata or subscription price
    const session = await this.stripeService.retrieveSession(sessionId);
    const metaPlanId = session.metadata?.planId || '';
    let priceIdFromStripe: string | undefined;
    if (session.mode === 'subscription' && session.subscription) {
      try {
        const subscription = await this.stripeService.retrieveSubscription(
          session.subscription as string,
        );
        priceIdFromStripe = subscription.items.data[0]?.price.id;
      } catch (e) {
        this.logger.warn(
          `Could not retrieve subscription for session ${sessionId}: ${(e as Error).message}`,
        );
      }
    }

    // Try resolve by metadata planId first
    if (metaPlanId) {
      const normalizedPlanId = normalizePlanId(
        metaPlanId,
        (session.metadata as any)?.billingPeriod as string | undefined,
      );
      const plan = getSubscriptionPlanById(normalizedPlanId);
      if (!plan) {
        throw new BadRequestException(
          `Could not resolve plan ${normalizedPlanId} from session metadata`,
        );
      }
      const stripePriceId =
        priceIdFromStripe || this.getPriceIdForSubscription(plan);
      this.logger.log(
        `🧭 Resolved plan from session metadata: ${plan.id} (${plan.name}), interval=${plan.interval}, priceId=${stripePriceId}`,
      );
      return {
        planId: plan.id,
        name: plan.name,
        credits: plan.credits,
        amount: plan.price,
        interval: plan.interval,
        stripePriceId,
      };
    }

    // Finally, try reverse-lookup by Stripe priceId if available
    if (priceIdFromStripe) {
      const plan = await this.getPlanByStripePriceId(priceIdFromStripe);
      if (plan) {
        this.logger.log(
          `🧭 Resolved plan from Stripe price: ${plan.id} (${plan.name}), interval=${plan.interval}, priceId=${priceIdFromStripe}`,
        );
        return {
          planId: plan.id,
          name: plan.name,
          credits: plan.credits,
          amount: plan.price || 0,
          interval: plan.interval,
          stripePriceId: priceIdFromStripe,
        };
      }
    }

    throw new BadRequestException(
      `Unable to resolve plan for session ${sessionId}. No pending payment metadata or recognizable Stripe data was found.`,
    );
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
        // FIX: Removed credits: 0 to preserve existing credit balances
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

  async createCustomerPortalSession(
    userAuthId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const user = (await this.prisma.user.findUnique({
      where: { authUserId: userAuthId },
    })) as any;
    if (!user?.stripeCustomerId) {
      throw new BadRequestException(
        'No Stripe customer linked to this account. Complete a checkout first.',
      );
    }

    const session = await this.stripeService.createBillingPortalSession(
      user.stripeCustomerId,
      returnUrl,
    );
    return { url: session.url };
  }

  /**
   * Report metered usage to Stripe for the user's active subscription
   */
  async reportUsageForUser(
    userAuthId: string,
    units: number,
    occurredAt?: Date,
    usageEventId?: string,
  ): Promise<{ usageRecordId: string } | null> {
    // Find active subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId: userAuthId },
    });
    const subAny = subscription as any;
    if (!subAny || !subAny.stripeSubscriptionItemId) {
      this.logger.warn(
        `No active subscription item for user ${userAuthId}; skipping usage report`,
      );
      return null;
    }

    const idempotencyKey = [
      'usage',
      userAuthId,
      subAny.stripeSubscriptionItemId,
      units.toString(),
      occurredAt ? Math.floor(occurredAt.getTime() / 1000).toString() : 'na',
      usageEventId || 'na',
    ]
      .filter(Boolean)
      .join(':');

    const record = await this.stripeService.createUsageRecord(
      subAny.stripeSubscriptionItemId,
      units,
      idempotencyKey,
      occurredAt,
    );

    try {
      if (usageEventId) {
        await this.prisma.usageEvent.update({
          where: { id: usageEventId },
          data: { stripeUsageRecordId: record.id || null } as any,
        });
      }
    } catch (e) {
      this.logger.warn(
        `Failed to persist stripeUsageRecordId for usageEvent ${usageEventId}: ${
          (e as Error).message
        }`,
      );
    }

    return { usageRecordId: record.id || '' };
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
    const paymentIntentId = (invoice as any).payment_intent as
      | string
      | undefined;
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

    // Determine credits for this cycle and update payment + subscription + user atomically
    let creditsForCycle = 0;
    try {
      const plan = await this.getPlanByStripePriceId(subscription.stripePriceId);
      creditsForCycle = plan?.credits || 0;
    } catch (e) {
      this.logger.warn(
        `⚠️ Plan resolution failed for ${subscription.stripePriceId}: ${(e as Error).message}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          userId: subscription.userId,
          stripePaymentIntentId: paymentIntentId || undefined,
          amount: Number((invoice as any).amount_paid || 0),
          credits: creditsForCycle,
          status: 'COMPLETED',
          type: 'SUBSCRIPTION',
          metadata: {
            invoiceId: invoice.id,
            periodStart: (invoice as any).period_start,
            periodEnd: (invoice as any).period_end,
          },
        },
      });

      if (creditsForCycle > 0) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { credits: { increment: creditsForCycle } },
        });
        await tx.user.update({
          where: { authUserId: subscription.userId },
          data: { credits: { increment: creditsForCycle } },
        });
      }
    });

    this.logger.log(
      `Processed recurring payment for subscription ${subscription.id} (credits +${creditsForCycle})`,
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
  ): Promise<{ message: string; paymentId?: string; subscriptionId?: string }> {
    console.log(
      `🚀 MANUAL PAYMENT COMPLETION STARTED for session: ${sessionId}`,
    );
    this.logger.log(
      `🚀 MANUAL PAYMENT COMPLETION STARTED for session: ${sessionId}`,
    );

    // NOTE: Previously, test sessions hardcoded plan/credits. We now reuse the
    // general flow below to reflect the actual selected plan.

    try {
      // Get the Stripe session to determine the mode
      const session = await this.stripeService.retrieveSession(sessionId);
      console.log(
        `📊 Session details: mode=${session.mode}, status=${session.payment_status}, subscription=${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
      );
      this.logger.log(
        `📊 Session details: mode=${session.mode}, status=${session.payment_status}, subscription=${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
      );

      if (session.mode === 'subscription') {
        // Handle subscription payment
        if (session.subscription) {
          console.log(
            `🔄 Processing subscription: ${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
          );
          this.logger.log(
            `Processing subscription: ${typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || 'null'}`,
          );

          // Retrieve the full subscription object
          const subscription = await this.stripeService.retrieveSubscription(
            session.subscription as string,
          );

          console.log(
            `📋 Retrieved subscription: ${subscription.id}, status: ${subscription.status}`,
          );

          // Process the subscription using the existing method
          try {
            await this.handleSuccessfulSubscriptionFromSession(
              subscription,
              session,
            );
            console.log(
              `✅ Subscription ${subscription.id} completed manually`,
            );
            this.logger.log(
              `✅ Subscription ${subscription.id} completed manually`,
            );
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
          credits: data.credits,
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

  /**
   * Complete payment for any user account - systematic solution (idempotent)
   */
  async completePaymentForUser(
    userId: string,
    sessionId: string,
    creditsOverride?: number,
  ): Promise<{
    message: string;
    creditsAdded: number;
    paymentId: string;
    subscriptionId: string;
  }> {
    console.log(
      `🎯 COMPLETE PAYMENT for user ${userId}, session: ${sessionId}`,
    );
    this.logger.log(
      `🎯 COMPLETE PAYMENT for user ${userId}, session: ${sessionId}`,
    );

    try {
      // Check if payment already exists for this session (idempotent check)
      const existingPayment = await this.prisma.payment.findUnique({
        where: { stripeSessionId: sessionId },
      });

      if (existingPayment && existingPayment.status === 'COMPLETED') {
        console.log(
          `✅ Payment already completed for session ${sessionId}, returning existing data`,
        );
        this.logger.log(
          `✅ Payment already completed for session ${sessionId}, returning existing data`,
        );

        // Get the user and subscription for response
        const user = await this.prisma.user.findUnique({
          where: { authUserId: existingPayment.userId },
        });

        const subscription = await this.prisma.subscription.findUnique({
          where: { userId: existingPayment.userId },
        });

        return {
          message: `Payment already completed! Added ${existingPayment.credits} credits to ${user?.email || 'user'}`,
          creditsAdded: existingPayment.credits,
          paymentId: existingPayment.id,
          subscriptionId: subscription?.id || 'unknown',
        };
      }

      // Find the user
      const user = await this.prisma.user.findUnique({
        where: { authUserId: userId },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Resolve selected plan and price (from pending payment or Stripe)
      const resolved = await this.resolvePlanFromSessionOrPending(sessionId);

      const creditsToAdd = await (async () => {
        const existing = await this.prisma.payment.findUnique({
          where: { stripeSessionId: sessionId },
        });
        if (existing?.credits && existing.credits > 0) return existing.credits;
        if (typeof creditsOverride === 'number') return creditsOverride;
        return resolved.credits;
      })();

      const amountToUse = await (async () => {
        const existing = await this.prisma.payment.findUnique({
          where: { stripeSessionId: sessionId },
        });
        if (typeof existing?.amount === 'number' && existing.amount > 0)
          return existing.amount;
        return resolved.amount;
      })();

      const newBalance = user.credits + creditsToAdd;

      console.log(
        `💰 Processing payment for user ${user.email} (${user.credits} → ${newBalance})`,
      );

      // Use transaction to ensure atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Create or update Payment record
        let payment;
        if (existingPayment && existingPayment.status === 'PENDING') {
          // Update existing pending payment
          payment = await tx.payment.update({
            where: { id: existingPayment.id },
            data: {
              status: 'COMPLETED',
              amount: amountToUse,
              credits: creditsToAdd,
              metadata: Object.assign(
                {},
                (existingPayment.metadata as any) || {},
                {
                  source: 'manual_completion',
                  testMode: sessionId.startsWith('cs_test_'),
                },
              ),
            },
          });
          console.log(`✅ Payment record updated: ${payment.id}`);
        } else {
          // Create new payment record
          payment = await tx.payment.create({
            data: {
              userId: user.authUserId,
              stripeSessionId: sessionId,
              amount: amountToUse,
              credits: creditsToAdd,
              status: 'COMPLETED',
              type: 'SUBSCRIPTION',
              metadata: {
                planId: resolved.planId,
                planName: resolved.name,
                billingPeriod:
                  resolved.interval === 'year' ? 'yearly' : 'monthly',
                source: 'manual_completion',
                testMode: sessionId.startsWith('cs_test_'),
              },
            },
          });
          console.log(`✅ Payment record created: ${payment.id}`);
        }

        // 2. Create or update Subscription record
        let subscription;
        const existingSubscription = await tx.subscription.findUnique({
          where: { userId: user.authUserId },
        });

        if (existingSubscription) {
          // Update existing subscription
          subscription = await tx.subscription.update({
            where: { id: existingSubscription.id },
            data: {
              credits: existingSubscription.credits + creditsToAdd,
              currentPeriodEnd: new Date(
                Date.now() +
                  (resolved.interval === 'year'
                    ? 365 * 24 * 60 * 60 * 1000
                    : 30 * 24 * 60 * 60 * 1000),
              ),
              status: 'ACTIVE',
            },
          });
          console.log(`✅ Subscription updated: ${subscription.id}`);
        } else {
          // Create new subscription
          subscription = await tx.subscription.create({
            data: {
              userId: user.authUserId,
              stripeSubscriptionId: `sub_${Date.now()}`,
              stripePriceId: resolved.stripePriceId,
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(
                Date.now() +
                  (resolved.interval === 'year'
                    ? 365 * 24 * 60 * 60 * 1000
                    : 30 * 24 * 60 * 60 * 1000),
              ),
              cancelAtPeriodEnd: false,
              credits: creditsToAdd,
            },
          });
          console.log(`✅ Subscription created: ${subscription.id}`);
        }

        // 3. Update User credits
        await tx.user.update({
          where: { authUserId: user.authUserId },
          data: { credits: newBalance },
        });

        console.log(`✅ User credits updated: ${newBalance}`);

        return { payment, subscription };
      });

      console.log(`🎉 COMPLETE PAYMENT SUCCESSFUL!`);

      // Invalidate cache since payment status changed
      this.invalidateSessionCache(sessionId);

      return {
        message: `Payment completed successfully! Added ${creditsToAdd} credits to ${user.email}`,
        creditsAdded: creditsToAdd,
        paymentId: result.payment.id,
        subscriptionId: result.subscription.id,
      };
    } catch (error) {
      console.error(`💥 Error in complete payment:`, error);
      this.logger.error(`💥 Error in complete payment:`, error);

      // Handle Prisma constraint errors gracefully
      if (error instanceof Error) {
        if (
          error.message.includes('Unique constraint') ||
          error.message.includes('duplicate key')
        ) {
          throw new Error('Payment already processed for this session');
        }
      }

      throw error;
    }
  }

  async addCreditsDirectlyForTesting(
    sessionId: string,
  ): Promise<{ message: string; creditsAdded: number }> {
    console.log(`🧪 DIRECT CREDIT ADDITION for testing session: ${sessionId}`);
    this.logger.log(
      `🧪 DIRECT CREDIT ADDITION for testing session: ${sessionId}`,
    );

    try {
      // Find a test user to add credits to
      const testUser = await this.prisma.user.findFirst({
        where: {
          email: 'domin6051@gmail.com',
        },
      });

      if (!testUser) {
        throw new Error('Test user not found');
      }

      // Use the systematic solution
      const result = await this.completePaymentForUser(
        testUser.authUserId,
        sessionId,
        1000,
      );

      return {
        message: result.message,
        creditsAdded: result.creditsAdded,
      };
    } catch (error) {
      console.error(`💥 Error in direct credit addition:`, error);
      this.logger.error(`💥 Error in direct credit addition:`, error);
      throw error;
    }
  }
}
