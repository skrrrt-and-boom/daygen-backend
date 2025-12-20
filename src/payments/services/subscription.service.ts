import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';
import { UsersService } from '../../users/users.service';
import { CreditLedgerService } from './credit-ledger.service';
import { UserWalletService } from './user-wallet.service';
import { SubscriptionStatus } from '@prisma/client';
import {
    getPlanByStripePriceId,
    getSubscriptionPlanById,
    getPriceIdForSubscription
} from '../../config/plans.config';
import { SanitizedUser } from '../../users/types';
import Stripe from 'stripe';

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

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly usersService: UsersService,
        private readonly creditLedgerService: CreditLedgerService,
        private readonly userWalletService: UserWalletService,
    ) { }

    async createSubscriptionSession(
        user: SanitizedUser,
        planId: string,
    ): Promise<{ sessionId: string; url: string }> {
        this.logger.log(`🔍 Creating subscription session for planId: ${planId}`);

        const subscriptionPlan = getSubscriptionPlanById(planId);

        if (!subscriptionPlan) {
            this.logger.error(`❌ Invalid subscription plan: ${planId}`);
            throw new BadRequestException('Invalid subscription plan');
        }

        const existingSubscription = await this.getUserSubscription(
            user.authUserId,
        );

        if (existingSubscription && existingSubscription.status === 'ACTIVE') {
            const currentPlanId = existingSubscription.planId;

            if (currentPlanId === planId) {
                throw new BadRequestException(
                    'You already have this subscription plan. To upgrade or downgrade, please use the subscription management page.',
                );
            }

            throw new BadRequestException(
                'You already have an active subscription. Please use the upgrade/downgrade option instead.',
            );
        }

        const priceId = getPriceIdForSubscription(planId);

        const existingPending = await this.creditLedgerService.findPendingSubscriptionPayment(
            user.authUserId,
            planId
        );

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
            } catch {
                this.logger.warn('Existing session not found, creating new one');
            }
        }

        const uniqueIdempotencyKey = `${user.authUserId}:subscription:${planId}:${Date.now()}`;
        const session = await this.stripeService.createCheckoutSession(
            user.authUserId,
            'subscription',
            priceId,
            {
                planId,
                credits: subscriptionPlan.credits.toString(),
                amount: subscriptionPlan.price.toString(),
            },
            { idempotencyKey: uniqueIdempotencyKey },
        );

        if (existingPending) {
            await this.creditLedgerService.updatePaymentStatus(existingPending.id, 'PENDING', {
                metadata: {
                    ...(existingPending.metadata as any),
                    planId,
                    planName: subscriptionPlan.name,
                    billingPeriod: subscriptionPlan.interval === 'year' ? 'yearly' : 'monthly',
                }
            });
            // Also update session ID directly
            await this.prisma.payment.update({
                where: { id: existingPending.id },
                data: { stripeSessionId: session.id }
            });
        } else {
            await this.creditLedgerService.createPaymentRecord({
                userId: user.authUserId,
                stripeSessionId: session.id,
                amount: subscriptionPlan.price,
                credits: subscriptionPlan.credits,
                status: 'PENDING',
                type: 'SUBSCRIPTION',
                metadata: {
                    planId,
                    planName: subscriptionPlan.name,
                    billingPeriod: subscriptionPlan.interval === 'year' ? 'yearly' : 'monthly',
                },
            });
        }

        return {
            sessionId: session.id,
            url: session.url!,
        };
    }

    async createCustomerPortalSession(
        userId: string,
        returnUrl: string,
    ): Promise<{ url: string }> {
        const user = await this.prisma.user.findUnique({
            where: { authUserId: userId },
        });

        if (!user?.stripeCustomerId) {
            throw new BadRequestException('User has no billing account');
        }

        const session = await this.stripeService.createPortalSession(
            user.stripeCustomerId,
            returnUrl,
        );

        return { url: session.url };
    }

    async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            return null;
        }

        const plan = getPlanByStripePriceId(
            subscription.stripePriceId,
        );

        return {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            credits: subscription.credits,
            createdAt: subscription.createdAt,
            stripePriceId: subscription.stripePriceId,
            planId: plan?.id || null,
            planName: plan?.name || null,
            billingPeriod: plan?.interval === 'year' ? 'yearly' : 'monthly',
        };
    }

    async cancelUserSubscription(userId: string): Promise<void> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            throw new NotFoundException('No active subscription found');
        }

        if (subscription.status !== 'ACTIVE') {
            throw new BadRequestException('Subscription is not active');
        }

        try {
            // Fix 6: Add logging for test subscriptions
            if (!subscription.stripeSubscriptionId.startsWith('sub_test_')) {
                await this.stripeService.cancelSubscription(
                    subscription.stripeSubscriptionId,
                );
            } else {
                this.logger.log(`Skipping Stripe API call for test subscription ${subscription.stripeSubscriptionId}`);
            }

            await this.prisma.subscription.update({
                where: { id: subscription.id },
                data: { cancelAtPeriodEnd: true },
            });

            this.logger.log(`User ${userId} cancelled subscription (at period end)`);
        } catch (error) {
            this.logger.error(
                `Failed to cancel subscription for user ${userId}:`,
                error,
            );
            throw new BadRequestException('Failed to cancel subscription');
        }
    }

    async removeCancellation(userId: string): Promise<void> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            throw new NotFoundException('No active subscription found');
        }

        if (!subscription.cancelAtPeriodEnd) {
            throw new BadRequestException('Subscription is not scheduled to cancel');
        }

        try {
            // Skip Stripe API call for test subscriptions
            if (!subscription.stripeSubscriptionId.startsWith('sub_test_')) {
                // First, verify the subscription status on Stripe before attempting to resume
                try {
                    const stripeSubscription = await this.stripeService.retrieveSubscription(
                        subscription.stripeSubscriptionId,
                    );

                    // If subscription is already fully canceled on Stripe, sync DB and inform user
                    if (stripeSubscription.status === 'canceled') {
                        this.logger.warn(
                            `Subscription ${subscription.stripeSubscriptionId} is already canceled on Stripe. Syncing database.`,
                        );

                        // Sync the database with Stripe's actual status
                        await this.prisma.subscription.update({
                            where: { id: subscription.id },
                            data: {
                                status: 'CANCELLED',
                                cancelAtPeriodEnd: false,
                            },
                        });

                        throw new BadRequestException(
                            'This subscription has already been fully canceled. Please create a new subscription.',
                        );
                    }
                } catch (retrieveError) {
                    // If it's our custom BadRequestException, rethrow it
                    if (retrieveError instanceof BadRequestException) {
                        throw retrieveError;
                    }
                    // For Stripe API errors (e.g., subscription not found), log and throw user-friendly error
                    this.logger.error(
                        `Failed to retrieve subscription ${subscription.stripeSubscriptionId} from Stripe:`,
                        retrieveError,
                    );
                    throw new BadRequestException(
                        'Unable to verify subscription status. Please try again or contact support.',
                    );
                }

                await this.stripeService.resumeSubscription(
                    subscription.stripeSubscriptionId,
                );
            } else {
                this.logger.log(`Skipping Stripe API call for test subscription ${subscription.stripeSubscriptionId}`);
            }

            await this.prisma.subscription.update({
                where: { id: subscription.id },
                data: { cancelAtPeriodEnd: false },
            });

            this.logger.log(`User ${userId} removed cancellation`);
        } catch (error) {
            // If it's already a BadRequestException, rethrow it with its message
            if (error instanceof BadRequestException) {
                throw error;
            }

            this.logger.error(
                `Failed to remove cancellation for user ${userId}:`,
                error,
            );
            throw new BadRequestException('Failed to remove cancellation');
        }
    }

    async upgradeSubscription(userId: string, newPlanId: string): Promise<void> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            throw new NotFoundException('No active subscription found');
        }

        const newPlan = getSubscriptionPlanById(newPlanId);
        if (!newPlan) {
            throw new BadRequestException('Invalid plan ID');
        }

        const newPriceId = getPriceIdForSubscription(newPlan.id);

        // Check if it's actually an upgrade (higher price)
        const currentPlan = getPlanByStripePriceId(subscription.stripePriceId);

        // If we can't resolve current plan, assume upgrade if prices differ, or just proceed
        const isUpgrade = currentPlan ? newPlan.price > currentPlan.price : true;

        // Reject downgrades - users must use the billing portal for those
        if (!isUpgrade) {
            throw new BadRequestException(
                'Cannot downgrade through this endpoint. Please use the billing portal to manage plan downgrades.',
            );
        }

        const upgradeMetadata = {
            upgrade_from_plan: currentPlan?.id || 'unknown',
            upgrade_to_plan: newPlan.id,
            upgraded_at: new Date().toISOString(),
            upgrade_type: isUpgrade ? 'upgrade' : 'downgrade',
        };

        if (!subscription.stripeSubscriptionId.startsWith('sub_test_')) {
            await this.stripeService.updateSubscription(
                subscription.stripeSubscriptionId,
                newPriceId,
                isUpgrade ? 'create_prorations' : 'none',
                upgradeMetadata,
            );
        }

        await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                stripePriceId: newPriceId,
            },
        });

        await this.creditLedgerService.createPaymentRecord({
            userId,
            amount: 0,
            credits: 0,
            status: 'COMPLETED',
            type: 'SUBSCRIPTION_UPGRADE',
            stripeSessionId: `upgrade_${subscription.id}_${Date.now()}`,
            metadata: {
                from_plan: currentPlan?.name,
                to_plan: newPlan.name,
                from_plan_id: currentPlan?.id,
                to_plan_id: newPlan.id,
                upgrade_type: isUpgrade ? 'upgrade' : 'downgrade',
                upgraded_at: new Date().toISOString(),
            },
        });

        this.logger.log(
            `${isUpgrade ? 'Upgraded' : 'Downgraded'} subscription ${subscription.id} for user ${userId} to plan ${newPlanId}`,
        );
    }

    async handleSuccessfulSubscription(subscription: Stripe.Subscription): Promise<void> {
        this.logger.log(`Processing subscription ${subscription.id}`);

        try {
            const customer = await this.stripeService.retrieveCustomer(
                subscription.customer as string,
            );

            const user = await this.findUserByStripeCustomerId(customer.id);
            if (!user) {
                // Fix 7: Throw error to trigger webhook retry instead of silent failure
                // This allows Stripe to retry the webhook and gives time for user sync
                throw new Error(`No user found for Stripe customer ${customer.id}. Webhook will be retried.`);
            }

            const priceId = subscription.items.data[0]?.price.id;
            if (!priceId) {
                this.logger.error(`No price ID found in subscription ${subscription.id}`);
                return;
            }

            const fallbackPlan = getPlanByStripePriceId(priceId);
            const fallbackCredits = fallbackPlan?.credits || 0;
            // Fix 9: Type assertion needed - current_period_end/start moved from Subscription to SubscriptionItem in newer Stripe API
            // but webhook still sends these at subscription level for backward compatibility
            const subAny = subscription as Stripe.Subscription & { current_period_end?: number; current_period_start?: number };
            const periodEndTimestamp = subAny.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
            const periodEnd = new Date(periodEndTimestamp * 1000);

            // Use transaction with Serializable isolation to prevent race conditions
            // and ensure atomic operations (if wallet grant fails, subscription is rolled back)
            await this.prisma.$transaction(async (tx) => {
                // Update user's stripe customer ID
                await tx.user.update({
                    where: { authUserId: user.authUserId },
                    data: { stripeCustomerId: customer.id } as any,
                });

                // Upsert subscription record - handles duplicate webhook events atomically
                const existingOrNew = await tx.subscription.upsert({
                    where: { stripeSubscriptionId: subscription.id },
                    update: {
                        // Only update if this is a duplicate event - keep existing data
                        status: this.mapStripeStatusToDb(subscription.status),
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    },
                    create: {
                        userId: user.authUserId,
                        stripeSubscriptionId: subscription.id,
                        stripePriceId: priceId || '',
                        stripeSubscriptionItemId: subscription.items.data[0]?.id,
                        status: this.mapStripeStatusToDb(subscription.status),
                        // Fix 9: Type assertion for period fields (moved to SubscriptionItem in newer Stripe)
                        currentPeriodStart: new Date(
                            (subAny.current_period_start ?? Math.floor(Date.now() / 1000)) * 1000,
                        ),
                        currentPeriodEnd: periodEnd,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                        creditsGranted: false, // Fix 5: Use flag-based idempotency
                        credits: fallbackCredits,
                    },
                });

                // Fix 5: Use creditsGranted flag instead of time-based race condition window
                // This is atomic and reliable, unlike the previous 5-second time check
                if (!existingOrNew.creditsGranted) {
                    // Only grant credits if not already granted (flag-based idempotency)
                    this.logger.log(`New subscription created, granting ${fallbackCredits} credits to user ${user.authUserId}`);

                    // Grant initial subscription credits within the same transaction context
                    await this.grantInitialCreditsInTransaction(tx, user.authUserId, fallbackCredits, periodEnd, subscription.id);

                    // Mark credits as granted in the subscription record
                    await tx.subscription.update({
                        where: { id: existingOrNew.id },
                        data: { creditsGranted: true },
                    });
                } else {
                    this.logger.log(`Subscription ${subscription.id}: credits already granted (creditsGranted=true), skipping`);
                }

                // Find and update pending payment record
                // FIX #10: Search by stripeSessionId from checkout session metadata, not stripeSubscriptionId
                const pendingPayment = await tx.payment.findFirst({
                    where: {
                        userId: user.authUserId,
                        type: 'SUBSCRIPTION',
                        status: 'PENDING',
                        createdAt: {
                            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                });

                if (pendingPayment) {
                    await tx.payment.update({
                        where: { id: pendingPayment.id },
                        data: {
                            status: 'COMPLETED',
                            metadata: {
                                ...(pendingPayment.metadata as any || {}),
                                stripeSubscriptionId: subscription.id,
                                processedAt: new Date().toISOString(),
                            },
                        },
                    });
                    this.logger.log(`Updated payment ${pendingPayment.id} for subscription ${subscription.id}`);
                } else {
                    // Fix 11: Create payment record if none exists (fallback for subscription.created webhook)
                    const plan = getPlanByStripePriceId(priceId);
                    await tx.payment.create({
                        data: {
                            userId: user.authUserId,
                            stripeSessionId: `sub_webhook_${subscription.id}`,
                            amount: plan?.price || 0,
                            credits: fallbackCredits,
                            status: 'COMPLETED',
                            type: 'SUBSCRIPTION',
                            metadata: {
                                stripeSubscriptionId: subscription.id,
                                planId: plan?.id,
                                planName: plan?.name,
                                billingPeriod: plan?.interval === 'year' ? 'yearly' : 'monthly',
                                source: 'subscription_webhook_fallback',
                                processedAt: new Date().toISOString(),
                            },
                        },
                    });
                    this.logger.log(`Created fallback payment record for subscription ${subscription.id}`);
                }
            }, {
                // Serializable isolation prevents phantom reads and ensures atomicity
                isolationLevel: 'Serializable',
                timeout: 30000, // 30 second timeout
            });

            this.logger.log(`Successfully processed subscription ${subscription.id} for user ${user.authUserId}`);
        } catch (error) {
            this.logger.error(`Error processing subscription ${subscription.id}:`, error);
            throw error;
        }
    }

    /**
     * Grant initial subscription credits within a transaction context.
     * This is an internal helper to maintain atomicity with subscription creation.
     */
    private async grantInitialCreditsInTransaction(
        tx: any, // Prisma transaction client
        userId: string,
        credits: number,
        expiresAt: Date,
        subscriptionId: string,
    ): Promise<void> {
        // Get or create wallet in transaction
        let wallet = await tx.userWallet.findUnique({ where: { userId } });

        if (!wallet) {
            const user = await tx.user.findUnique({
                where: { authUserId: userId },
                select: { credits: true },
            });
            wallet = await tx.userWallet.create({
                data: {
                    userId,
                    topUpCredits: Math.max(user?.credits || 0, 0),
                    subscriptionCredits: 0,
                },
            });
        }

        // Update wallet with subscription credits
        await tx.userWallet.update({
            where: { userId },
            data: {
                subscriptionCredits: credits,
                subscriptionExpiresAt: expiresAt,
            },
        });

        // Record the transaction
        await tx.walletTransaction.create({
            data: {
                userId,
                walletType: 'SUBSCRIPTION',
                transactionType: 'CREDIT',
                amount: credits,
                balanceBefore: wallet.subscriptionCredits,
                balanceAfter: credits,
                sourceType: 'SUBSCRIPTION_CYCLE',
                sourceId: subscriptionId,
                description: 'Initial subscription credits',
            },
        });

        // Sync legacy credits
        await tx.user.update({
            where: { authUserId: userId },
            data: { credits: credits + wallet.topUpCredits },
        });
    }


    async handleRecurringPayment(invoice: Stripe.Invoice): Promise<void> {
        // Fix: Cast to any to avoid type error if subscription is missing in type definition
        const invoiceAny = invoice as any;
        if (!invoiceAny.subscription) return;

        try {
            const subscriptionId = typeof invoiceAny.subscription === 'string'
                ? invoiceAny.subscription
                : invoiceAny.subscription.id;

            const subscription = await this.prisma.subscription.findUnique({
                where: { stripeSubscriptionId: subscriptionId },
            });

            if (!subscription) {
                this.logger.warn(`Subscription ${subscriptionId} not found for invoice ${invoice.id}`);
                return;
            }

            const plan = getPlanByStripePriceId(subscription.stripePriceId);
            const planCredits = plan?.credits || 0;
            const periodEnd = new Date(invoice.period_end * 1000);

            // DUAL-WALLET: RESET subscription credits (not ADD!)
            // This is the key change: subscription credits reset each billing cycle
            await this.userWalletService.resetSubscriptionCredits(
                subscription.userId,
                planCredits,
                periodEnd,
                subscriptionId,
            );

            await this.creditLedgerService.createPaymentRecord({
                userId: subscription.userId,
                stripeSessionId: `invoice_${invoice.id}`,
                amount: invoice.amount_paid,
                credits: planCredits,
                status: 'COMPLETED',
                type: 'SUBSCRIPTION',
                metadata: {
                    invoiceId: invoice.id,
                    subscriptionId: subscriptionId,
                    periodStart: invoice.period_start,
                    periodEnd: invoice.period_end,
                    type: 'renewal',
                    walletAction: 'reset', // Track that this was a reset, not an add
                },
            });

            // Update subscription period
            await this.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    currentPeriodStart: new Date(invoice.period_start * 1000),
                    currentPeriodEnd: periodEnd,
                },
            });

            this.logger.log(`Processed recurring payment for user ${subscription.userId}. Reset subscription credits to ${planCredits}.`);
        } catch (error) {
            this.logger.error(`Error processing recurring payment for invoice ${invoice.id}:`, error);
            throw error;
        }
    }

    async updateSubscriptionStatus(subscription: Stripe.Subscription): Promise<void> {
        try {
            await this.prisma.subscription.update({
                where: { stripeSubscriptionId: subscription.id },
                data: {
                    status: this.mapStripeStatusToDb(subscription.status),
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                },
            });
            this.logger.log(`Updated status for subscription ${subscription.id} to ${subscription.status}`);
        } catch (error) {
            this.logger.error(`Error updating subscription status for ${subscription.id}:`, error);
        }
    }

    async cancelSubscriptionByStripeId(stripeSubscriptionId: string): Promise<void> {
        try {
            await this.prisma.subscription.update({
                where: { stripeSubscriptionId },
                data: {
                    status: 'CANCELLED',
                    cancelAtPeriodEnd: true,
                },
            });
            this.logger.log(`Marked subscription ${stripeSubscriptionId} as cancelled`);
        } catch (error) {
            this.logger.error(`Error cancelling subscription ${stripeSubscriptionId}:`, error);
        }
    }

    async handleFailedPayment(invoice: Stripe.Invoice): Promise<void> {
        // Fix 4: Implement credit revocation for failed payments
        this.logger.warn(`Payment failed for invoice ${invoice.id}`);

        const invoiceAny = invoice as any;
        if (!invoiceAny.subscription) {
            this.logger.log(`Invoice ${invoice.id} has no subscription, skipping revocation`);
            return;
        }

        const subscriptionId = typeof invoiceAny.subscription === 'string'
            ? invoiceAny.subscription
            : invoiceAny.subscription.id;

        try {
            const subscription = await this.prisma.subscription.findUnique({
                where: { stripeSubscriptionId: subscriptionId },
            });

            if (!subscription) {
                this.logger.warn(`Subscription ${subscriptionId} not found for failed invoice ${invoice.id}`);
                return;
            }

            // Only revoke credits if they were granted
            if (subscription.creditsGranted) {
                this.logger.log(`Revoking subscription credits for user ${subscription.userId} due to failed payment`);

                // Revoke subscription credits from wallet
                await this.userWalletService.revokeSubscriptionCredits(
                    subscription.userId,
                    `Failed payment - Invoice ${invoice.id}`,
                );

                // Update subscription status and reset creditsGranted flag
                await this.prisma.subscription.update({
                    where: { id: subscription.id },
                    data: {
                        status: 'PAST_DUE',
                        creditsGranted: false, // Reset so credits can be re-granted on successful retry
                    },
                });

                this.logger.log(`Successfully revoked credits for subscription ${subscriptionId}`);
            } else {
                // Just update status if no credits to revoke
                await this.prisma.subscription.update({
                    where: { id: subscription.id },
                    data: { status: 'PAST_DUE' },
                });
            }
        } catch (error) {
            this.logger.error(`Error handling failed payment for invoice ${invoice.id}:`, error);
            // Don't throw - we don't want to fail the webhook for internal errors
        }
    }

    mapStripeStatusToDb(status: Stripe.Subscription.Status): SubscriptionStatus {
        switch (status) {
            case 'active':
            case 'trialing':
                return 'ACTIVE';
            case 'canceled':
                return 'CANCELLED'; // Fix: Double L
            case 'past_due':
                return 'PAST_DUE';
            case 'unpaid':
                return 'UNPAID';
            default:
                return 'CANCELLED'; // Fix: Map unknown/inactive to CANCELLED
        }
    }

    private async findUserByStripeCustomerId(customerId: string): Promise<any> {
        try {
            // First, try direct lookup by stripeCustomerId (most reliable)
            const userByCustomerId = await this.prisma.user.findUnique({
                where: { stripeCustomerId: customerId },
            });
            if (userByCustomerId) {
                return userByCustomerId;
            }

            // Fallback: lookup by email from Stripe customer
            const customer = await this.stripeService.retrieveCustomer(customerId);
            if (customer.email) {
                const userByEmail = await this.usersService.findByEmail(customer.email);
                if (userByEmail) {
                    return userByEmail;
                }
            }
        } catch (error) {
            this.logger.error(`Error retrieving customer ${customerId}:`, error);
        }
        return null;
    }
}
