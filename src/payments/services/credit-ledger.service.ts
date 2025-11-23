import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, PaymentType } from '@prisma/client';

export interface PaymentHistoryItem {
    id: string;
    amount: number;
    credits: number;
    status: PaymentStatus;
    type: PaymentType;
    createdAt: Date;
    metadata?: any;
}

@Injectable()
export class CreditLedgerService {
    private readonly logger = new Logger(CreditLedgerService.name);

    constructor(private readonly prisma: PrismaService) { }

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
                status: 'COMPLETED',
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
