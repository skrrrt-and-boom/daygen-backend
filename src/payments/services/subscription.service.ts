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
            if (!subscription.stripeSubscriptionId.startsWith('sub_test_')) {
                await this.stripeService.cancelSubscription(
                    subscription.stripeSubscriptionId,
                );
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
            if (!subscription.stripeSubscriptionId.startsWith('sub_test_')) {
                await this.stripeService.resumeSubscription(
                    subscription.stripeSubscriptionId,
                );
            }

            await this.prisma.subscription.update({
                where: { id: subscription.id },
                data: { cancelAtPeriodEnd: false },
            });

            this.logger.log(`User ${userId} removed cancellation`);
        } catch (error) {
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
        this.logger.log(`Processing subscription ${subscription.id} without session metadata`);

        try {
            const customer = await this.stripeService.retrieveCustomer(
                subscription.customer as string,
            );

            const user = await this.findUserByStripeCustomerId(customer.id);
            if (!user) {
                this.logger.error(`No user found for Stripe customer ${customer.id}`);
                return;
            }

            const priceId = subscription.items.data[0]?.price.id;
            if (!priceId) {
                this.logger.error(`No price ID found in subscription ${subscription.id}`);
                return;
            }

            const existingSubscription = await this.prisma.subscription.findUnique({
                where: { stripeSubscriptionId: subscription.id },
            });

            if (existingSubscription) {
                this.logger.log(`Subscription ${subscription.id} already exists in database`);
                return;
            }

            await this.prisma.user.update({
                where: { authUserId: user.authUserId },
                data: { stripeCustomerId: customer.id } as any,
            });

            const fallbackPlan = getPlanByStripePriceId(priceId);
            const fallbackCredits = fallbackPlan?.credits || 0;

            await this.prisma.subscription.upsert({
                where: { stripeSubscriptionId: subscription.id },
                update: {
                    userId: user.authUserId,
                    stripePriceId: priceId || undefined,
                    stripeSubscriptionItemId: subscription.items.data[0]?.id,
                    status: this.mapStripeStatusToDb(subscription.status),
                    currentPeriodStart: new Date(
                        ((subscription as any).current_period_start || Math.floor(Date.now() / 1000)) * 1000,
                    ),
                    currentPeriodEnd: new Date(
                        ((subscription as any).current_period_end || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
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
                        ((subscription as any).current_period_start || Math.floor(Date.now() / 1000)) * 1000,
                    ),
                    currentPeriodEnd: new Date(
                        ((subscription as any).current_period_end || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
                    ),
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    credits: fallbackCredits,
                },
            });

            // DUAL-WALLET: Grant initial subscription credits
            const periodEnd = new Date(
                ((subscription as any).current_period_end || Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000,
            );

            await this.userWalletService.grantInitialSubscriptionCredits(
                user.authUserId,
                fallbackCredits,
                periodEnd,
                subscription.id,
            );
            this.logger.log(`Granted ${fallbackCredits} initial subscription credits to user ${user.authUserId}`);

            const subscriptionPayment = await this.creditLedgerService.findPendingSubscriptionPaymentByStripeId(
                user.authUserId,
                subscription.id
            );

            if (subscriptionPayment) {
                await this.creditLedgerService.updatePaymentStatus(subscriptionPayment.id, 'COMPLETED');
                this.logger.log(`Updated payment ${subscriptionPayment.id} for subscription ${subscription.id}`);
            }

            this.logger.log(`Successfully processed subscription ${subscription.id} for user ${user.authUserId}`);
        } catch (error) {
            this.logger.error(`Error processing subscription ${subscription.id}:`, error);
            throw error;
        }
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
        // Logic to handle failed payment (e.g., notify user, maybe revoke credits if they were optimistically granted?)
        // For now, just log it as per original service
        this.logger.warn(`Payment failed for invoice ${invoice.id}`);
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
