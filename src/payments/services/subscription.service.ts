import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';
import { UsersService } from '../../users/users.service';
import { PlanConfigService } from './plan-config.service';
import { CreditLedgerService } from './credit-ledger.service';
import { SubscriptionStatus } from '@prisma/client';
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
        private readonly planConfigService: PlanConfigService,
        private readonly creditLedgerService: CreditLedgerService,
    ) { }

    async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            return null;
        }

        const plan = this.planConfigService.getPlanByStripePriceId(
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

        const newPlan = this.planConfigService.getSubscriptionPlanById(newPlanId);
        if (!newPlan) {
            throw new BadRequestException('Invalid plan ID');
        }

        const newPriceId = this.planConfigService.getPriceIdForSubscription(newPlan.id);

        // Check if it's actually an upgrade (higher price)
        const currentPlan = this.planConfigService.getPlanByStripePriceId(subscription.stripePriceId);

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

            const fallbackPlan = this.planConfigService.getPlanByStripePriceId(priceId);
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

            const plan = this.planConfigService.getPlanByStripePriceId(subscription.stripePriceId);
            const creditsToAdd = plan?.credits || 0;

            await this.creditLedgerService.addCredits(subscription.userId, creditsToAdd);

            await this.creditLedgerService.createPaymentRecord({
                userId: subscription.userId,
                stripeSessionId: `invoice_${invoice.id}`,
                amount: invoice.amount_paid,
                credits: creditsToAdd,
                status: 'COMPLETED',
                // Fix: Use SUBSCRIPTION instead of SUBSCRIPTION_RENEWAL
                type: 'SUBSCRIPTION',
                metadata: {
                    invoiceId: invoice.id,
                    subscriptionId: subscriptionId,
                    periodStart: invoice.period_start,
                    periodEnd: invoice.period_end,
                    type: 'renewal' // Add type in metadata instead
                },
            });

            // Update subscription period
            await this.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    currentPeriodStart: new Date(invoice.period_start * 1000),
                    currentPeriodEnd: new Date(invoice.period_end * 1000),
                },
            });

            this.logger.log(`Processed recurring payment for user ${subscription.userId}. Added ${creditsToAdd} credits.`);
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
