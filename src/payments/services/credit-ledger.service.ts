import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, PaymentType } from '@prisma/client';
import { StripeService } from '../stripe.service';
import { SanitizedUser } from '../../users/types';
import {
    getCreditPackageById,
    getPriceIdForPackage
} from '../../config/plans.config';
import { UserWalletService } from './user-wallet.service';

export interface PaymentHistoryItem {
    id: string;
    amount: number;
    credits: number;
    status: PaymentStatus;
    type: PaymentType;
    createdAt: Date;
    metadata?: any;
}

type SessionStatusResult = {
    status: string;
    paymentStatus?: string;
    mode?: string;
    metadata?: any;
};

@Injectable()
export class CreditLedgerService {
    private readonly logger = new Logger(CreditLedgerService.name);

    // In-memory cache for session status with TTL
    private sessionCache = new Map<string, { data: any; expires: number }>();
    private readonly CACHE_TTL = 120 * 1000; // 120 seconds
    private readonly MAX_CACHE_SIZE = 1000; // Prevent unbounded growth
    private cacheCleanupInterval: NodeJS.Timeout | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly userWalletService: UserWalletService,
    ) {
        // Start cache cleanup interval (every 5 minutes)
        this.cacheCleanupInterval = setInterval(() => {
            this.cleanupExpiredCache();
        }, 5 * 60 * 1000);
    }

    onModuleDestroy() {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }
    }

    private cleanupExpiredCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, value] of this.sessionCache) {
            if (value.expires < now) {
                this.sessionCache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.debug(`Cleaned ${cleaned} expired session cache entries`);
        }
    }

    async createOneTimePurchaseSession(
        user: SanitizedUser,
        packageId: string,
    ): Promise<{ sessionId: string; url: string }> {
        const creditPackage = getCreditPackageById(packageId);
        if (!creditPackage) {
            throw new BadRequestException('Invalid credit package');
        }

        const priceId = getPriceIdForPackage(packageId);

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

        await this.createPaymentRecord({
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

    async handleSuccessfulPayment(session: { id: string; payment_intent?: string | null; mode?: string }): Promise<void> {
        const payment = await this.findPaymentBySessionId(session.id);

        if (!payment) {
            this.logger.error(`Payment not found for session ${session.id}`);
            return;
        }

        if (payment.status === 'COMPLETED') {
            this.logger.warn(`Payment ${payment.id} already processed`);
            return;
        }

        // Update payment status first
        await this.prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: 'COMPLETED',
                stripePaymentIntentId: (session.payment_intent as string) || null,
            },
        });

        // DUAL-WALLET: Add credits to top-up wallet (perpetual credits)
        await this.userWalletService.addTopUpCredits(
            payment.userId,
            payment.credits,
            session.id,
            `Top-up purchase: ${payment.credits} credits`,
        );

        this.logger.log(`Successfully processed one-time payment ${session.id}. Added ${payment.credits} top-up credits.`);
        this.invalidateSessionCache(session.id);
    }

    async getSessionStatus(sessionId: string): Promise<SessionStatusResult> {
        const cached = this.sessionCache.get(sessionId);
        if (cached && cached.expires > Date.now()) {
            return cached.data;
        }

        const session = await this.stripeService.retrieveSession(sessionId);
        const payment = await this.findPaymentBySessionId(sessionId);

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

    async addCredits(userId: string, amount: number): Promise<void> {
        await this.prisma.user.update({
            where: { authUserId: userId },
            data: { credits: { increment: amount } },
        });
        this.logger.log(`Added ${amount} credits to user ${userId}`);
    }

    async refundCredits(userId: string, amount: number, reason: string): Promise<void> {
        await this.prisma.user.update({
            where: { authUserId: userId },
            data: { credits: { decrement: amount } },
        });
        this.logger.log(`Refunded ${amount} credits for user ${userId}. Reason: ${reason}`);
    }

    async getUserPaymentHistory(userId: string, limit = 50): Promise<PaymentHistoryItem[]> {
        const payments = await this.prisma.payment.findMany({
            where: {
                userId,
                status: { in: ['COMPLETED', 'PENDING', 'FAILED'] },
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: limit,
        });

        return payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            credits: p.credits,
            status: p.status,
            type: p.type,
            createdAt: p.createdAt,
            metadata: p.metadata,
        }));
    }

    async createPaymentRecord(data: {
        userId: string;
        stripeSessionId: string;
        amount: number;
        credits: number;
        status: PaymentStatus;
        type: PaymentType;
        metadata?: any;
    }) {
        return this.prisma.payment.create({
            data,
        });
    }

    async updatePaymentStatus(
        paymentId: string,
        status: PaymentStatus,
        extraData?: {
            stripePaymentIntentId?: string;
            amount?: number;
            credits?: number;
            metadata?: any;
        },
    ) {
        return this.prisma.payment.update({
            where: { id: paymentId },
            data: {
                status,
                ...extraData,
            },
        });
    }

    async findPaymentBySessionId(sessionId: string) {
        return this.prisma.payment.findUnique({
            where: { stripeSessionId: sessionId },
        });
    }

    async findPaymentByIntentId(paymentIntentId: string) {
        return this.prisma.payment.findFirst({
            where: { stripePaymentIntentId: paymentIntentId },
        });
    }

    async findPendingSubscriptionPayment(userId: string, planId: string) {
        return this.prisma.payment.findFirst({
            where: {
                userId,
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
    }

    async findPendingSubscriptionPaymentByStripeId(userId: string, stripeSubscriptionId: string) {
        return this.prisma.payment.findFirst({
            where: {
                userId,
                type: 'SUBSCRIPTION',
                status: 'PENDING',
                metadata: {
                    path: ['stripeSubscriptionId'],
                    equals: stripeSubscriptionId,
                },
            },
        });
    }
}
