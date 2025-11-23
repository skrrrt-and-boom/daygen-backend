import {
    Injectable,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';
import { PlanConfigService } from './plan-config.service';
import { CreditLedgerService } from './credit-ledger.service';
import { SubscriptionService } from './subscription.service';
import { SanitizedUser } from '../../users/types';
import Stripe from 'stripe';

type SessionStatusResult = {
    status: string;
    paymentStatus?: string;
    mode?: string;
    metadata?: any;
};

@Injectable()
export class CheckoutSessionService {
    private readonly logger = new Logger(CheckoutSessionService.name);

    // In-memory cache for session status with TTL
    private sessionCache = new Map<string, { data: any; expires: number }>();
    private readonly CACHE_TTL = 120 * 1000; // 120 seconds;

    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly planConfigService: PlanConfigService,
        private readonly creditLedgerService: CreditLedgerService,
        private readonly subscriptionService: SubscriptionService,
    ) { }

    async createOneTimePurchaseSession(
        user: SanitizedUser,
        packageId: string,
    ): Promise<{ sessionId: string; url: string }> {
        const creditPackage = this.planConfigService.getCreditPackageById(packageId);
        if (!creditPackage) {
            throw new BadRequestException('Invalid credit package');
        }

        const priceId = this.planConfigService.getPriceIdForPackage(packageId);

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

        await this.creditLedgerService.createPaymentRecord({
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

        const subscriptionPlan = this.planConfigService.getSubscriptionPlanById(planId);

        if (!subscriptionPlan) {
            this.logger.error(`❌ Invalid subscription plan: ${planId}`);
            throw new BadRequestException('Invalid subscription plan');
        }

        const existingSubscription = await this.subscriptionService.getUserSubscription(
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

        const priceId = this.planConfigService.getPriceIdForSubscription(planId);

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
            // Also update session ID which is not in updatePaymentStatus helper, so use prisma directly or add to helper
            // I'll just use prisma directly here for simplicity or update helper
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

    async handleSuccessfulPayment(session: Stripe.Checkout.Session): Promise<void> {
        const payment = await this.creditLedgerService.findPaymentBySessionId(session.id);

        if (!payment) {
            this.logger.error(`Payment not found for session ${session.id}`);
            return;
        }

        if (payment.status === 'COMPLETED') {
            this.logger.warn(`Payment ${payment.id} already processed`);
            return;
        }

        await this.prisma.$transaction(async (tx) => {
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

    async getSessionStatus(sessionId: string): Promise<SessionStatusResult> {
        const cached = this.sessionCache.get(sessionId);
        if (cached && cached.expires > Date.now()) {
            return cached.data;
        }

        const session = await this.stripeService.retrieveSession(sessionId);
        const payment = await this.creditLedgerService.findPaymentBySessionId(sessionId);

        const result: SessionStatusResult = {
            status: session.payment_status,
            paymentStatus: payment?.status || 'PENDING',
            mode: session.mode,
        };

        if (session.mode === 'subscription' && payment?.metadata) {
            const metadata = payment.metadata as any;
            result.metadata = {
                planName: metadata.planName,
                billingPeriod: metadata.billingPeriod || 'monthly',
                planId: metadata.planId,
            };
        }

        this.sessionCache.set(sessionId, {
            data: result,
            expires: Date.now() + this.CACHE_TTL,
        });

        return result;
    }

    private invalidateSessionCache(sessionId: string): void {
        this.sessionCache.delete(sessionId);
    }
}
