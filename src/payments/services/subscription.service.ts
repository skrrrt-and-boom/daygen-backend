import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';
import { UsersService } from '../../users/users.service';
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
    pendingPlanId?: string | null;
    pendingPlanName?: string | null;
    pendingPlanCredits?: number | null;
    pendingChangeDate?: Date | null;
    pendingBillingPeriod?: 'monthly' | 'yearly' | null;
}

/**
 * Minimal Subscription Service (~250 lines)
 */
@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly usersService: UsersService,
        private readonly userWalletService: UserWalletService,
    ) { }

    // ==================== Checkout ====================

    async createSubscriptionSession(
        user: SanitizedUser,
        planId: string,
    ): Promise<{ sessionId: string; url: string }> {
        const plan = getSubscriptionPlanById(planId);
        if (!plan) throw new BadRequestException('Invalid subscription plan');

        const existing = await this.getUserSubscription(user.authUserId);
        if (existing?.status === 'ACTIVE') {
            throw new BadRequestException('You already have an active subscription');
        }

        const priceId = getPriceIdForSubscription(planId);
        const session = await this.stripeService.createCheckoutSession(
            user.authUserId,
            'subscription',
            priceId,
            { planId, credits: plan.credits.toString() },
        );

        return { sessionId: session.id, url: session.url! };
    }

    async createCustomerPortalSession(userId: string, returnUrl: string): Promise<{ url: string }> {
        const user = await this.prisma.user.findUnique({ where: { authUserId: userId } });
        if (!user?.stripeCustomerId) throw new BadRequestException('No billing account');

        const session = await this.stripeService.createPortalSession(user.stripeCustomerId, returnUrl);
        return { url: session.url };
    }

    async cancelUserSubscription(userId: string): Promise<void> {
        const sub = await this.prisma.subscription.findUnique({ where: { userId } });
        if (!sub || sub.status !== 'ACTIVE') throw new NotFoundException('No active subscription');

        await this.stripeService.cancelSubscription(sub.stripeSubscriptionId);
        await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { cancelAtPeriodEnd: true },
        });
    }

    async removeCancellation(userId: string): Promise<void> {
        const sub = await this.prisma.subscription.findUnique({ where: { userId } });
        if (!sub?.cancelAtPeriodEnd) throw new BadRequestException('Not scheduled to cancel');

        await this.stripeService.removeCancellation(sub.stripeSubscriptionId);
        await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { cancelAtPeriodEnd: false },
        });
    }

    // ==================== Query ====================

    async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
        const sub = await this.prisma.subscription.findUnique({ where: { userId } });
        if (!sub) return null;

        const plan = getPlanByStripePriceId(sub.stripePriceId);
        return {
            id: sub.id,
            status: sub.status,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            credits: sub.credits,
            createdAt: sub.createdAt,
            stripePriceId: sub.stripePriceId,
            planId: plan?.id || null,
            planName: plan?.name || null,
            billingPeriod: plan?.interval === 'year' ? 'yearly' : 'monthly',
        };
    }

    // ==================== Webhook Handlers ====================

    async handleSuccessfulSubscription(sub: Stripe.Subscription): Promise<void> {
        const customer = await this.stripeService.retrieveCustomer(sub.customer as string);
        const user = await this.findUserByStripeCustomerId(customer.id);
        if (!user) throw new Error(`No user for customer ${customer.id}`);

        const priceId = sub.items.data[0]?.price.id;
        const plan = getPlanByStripePriceId(priceId);
        if (!plan) throw new Error(`Unknown price: ${priceId}`);

        // Type guard for Stripe subscription period properties
        const subAny = sub as any;
        const periodEnd = new Date((subAny.current_period_end || Math.floor(Date.now() / 1000)) * 1000);
        const periodStart = new Date((subAny.current_period_start || Math.floor(Date.now() / 1000)) * 1000);

        await this.prisma.$transaction(async (tx) => {
            const record = await tx.subscription.upsert({
                where: { stripeSubscriptionId: sub.id },
                create: {
                    userId: user.authUserId,
                    stripeSubscriptionId: sub.id,
                    stripePriceId: priceId,
                    status: this.mapStatus(sub.status),
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    cancelAtPeriodEnd: sub.cancel_at_period_end,
                    credits: plan.credits,
                    creditsGranted: false,
                },
                update: {
                    status: this.mapStatus(sub.status),
                    cancelAtPeriodEnd: sub.cancel_at_period_end,
                },
            });

            if (!record.creditsGranted) {
                await tx.userWallet.upsert({
                    where: { userId: user.authUserId },
                    create: { userId: user.authUserId, subscriptionCredits: plan.credits, subscriptionExpiresAt: periodEnd },
                    update: { subscriptionCredits: plan.credits, subscriptionExpiresAt: periodEnd },
                });
                await tx.subscription.update({
                    where: { id: record.id },
                    data: { creditsGranted: true },
                });
                this.logger.log(`Granted ${plan.credits} credits to ${user.authUserId}`);
            }
        });
    }

    async handleRecurringPayment(invoice: Stripe.Invoice): Promise<void> {
        const subId = (invoice as any).subscription as string;
        const sub = await this.prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subId },
        });
        if (!sub) return;

        const plan = getPlanByStripePriceId(sub.stripePriceId);
        const periodEnd = new Date(invoice.period_end * 1000);

        await this.userWalletService.resetSubscriptionCredits(
            sub.userId,
            plan?.credits || 0,
            periodEnd,
            subId,
        );

        await this.prisma.subscription.update({
            where: { id: sub.id },
            data: {
                currentPeriodStart: new Date(invoice.period_start * 1000),
                currentPeriodEnd: periodEnd,
            },
        });
    }

    async updateSubscriptionStatus(sub: Stripe.Subscription): Promise<void> {
        await this.prisma.subscription.updateMany({
            where: { stripeSubscriptionId: sub.id },
            data: {
                status: this.mapStatus(sub.status),
                cancelAtPeriodEnd: sub.cancel_at_period_end,
            },
        });
    }

    async cancelSubscriptionByStripeId(stripeSubscriptionId: string): Promise<void> {
        await this.prisma.subscription.updateMany({
            where: { stripeSubscriptionId },
            data: { status: 'CANCELLED', cancelAtPeriodEnd: true },
        });
    }

    async handleFailedPayment(invoice: Stripe.Invoice): Promise<void> {
        const subId = (invoice as any).subscription as string;
        if (!subId) return;

        const sub = await this.prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subId },
        });
        if (!sub?.creditsGranted) return;

        await this.userWalletService.revokeSubscriptionCredits(sub.userId, `Failed: ${invoice.id}`);
        await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'PAST_DUE', creditsGranted: false },
        });
    }

    // ==================== Helpers ====================

    private mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
        switch (status) {
            case 'active':
            case 'trialing':
                return 'ACTIVE';
            case 'past_due':
                return 'PAST_DUE';
            case 'unpaid':
                return 'UNPAID';
            default:
                return 'CANCELLED';
        }
    }

    private async findUserByStripeCustomerId(customerId: string) {
        let user = await this.prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
        if (user) return user;

        const customer = await this.stripeService.retrieveCustomer(customerId);
        if (customer.email) {
            user = await this.usersService.findByEmail(customer.email);
        }
        return user;
    }
}

