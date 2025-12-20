import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletType, TransactionType, Prisma } from '@prisma/client';

export interface WalletBalance {
    subscriptionCredits: number;
    topUpCredits: number;
    totalCredits: number;
    subscriptionExpiresAt: Date | null;
    graceLimit: number;
}

export interface DeductResult {
    subscriptionDeducted: number;
    topUpDeducted: number;
    totalDeducted: number;
    newSubscriptionBalance: number;
    newTopUpBalance: number;
}

export class InsufficientCreditsError extends Error {
    constructor(
        public readonly required: number,
        public readonly available: number,
    ) {
        super(`Insufficient credits. Required: ${required}, Available: ${available}`);
        this.name = 'InsufficientCreditsError';
    }
}

@Injectable()
export class UserWalletService {
    private readonly logger = new Logger(UserWalletService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Fix 14: Centralized helper to sync legacy user.credits field with wallet balances.
     * This prevents drift between the dual-wallet system and legacy code that still reads user.credits.
     */
    private async syncLegacyCredits(
        tx: Prisma.TransactionClient,
        userId: string,
        subscriptionCredits: number,
        topUpCredits: number,
    ): Promise<void> {
        await tx.user.update({
            where: { authUserId: userId },
            data: { credits: subscriptionCredits + topUpCredits },
        });
    }

    /**
     * Create a new wallet for a user
     */
    async createWallet(userId: string, initialTopUpCredits: number = 0) {
        return this.prisma.userWallet.create({
            data: {
                userId,
                topUpCredits: initialTopUpCredits,
                subscriptionCredits: 0,
            },
        });
    }

    /**
     * Get or create wallet for user
     */
    async getOrCreateWallet(userId: string) {
        let wallet = await this.prisma.userWallet.findUnique({
            where: { userId },
        });

        if (!wallet) {
            // Migrate existing credits from User table
            const user = await this.prisma.user.findUnique({
                where: { authUserId: userId },
                select: { credits: true },
            });

            wallet = await this.prisma.userWallet.create({
                data: {
                    userId,
                    topUpCredits: Math.max(user?.credits || 0, 0),
                    subscriptionCredits: 0,
                },
            });

            this.logger.log(`Created wallet for user ${userId} with ${wallet.topUpCredits} top-up credits`);
        }

        return wallet;
    }

    /**
     * Get wallet balance for display
     */
    async getBalance(userId: string): Promise<WalletBalance> {
        const wallet = await this.getOrCreateWallet(userId);

        return {
            subscriptionCredits: wallet.subscriptionCredits,
            topUpCredits: wallet.topUpCredits,
            totalCredits: wallet.subscriptionCredits + wallet.topUpCredits,
            subscriptionExpiresAt: wallet.subscriptionExpiresAt,
            graceLimit: wallet.graceLimit,
        };
    }

    /**
     * Smart deduction: subscription credits first, then top-up credits, then grace
     * Uses a transaction for atomicity
     */
    async deductCredits(
        userId: string,
        cost: number,
        sourceType: string,
        sourceId?: string,
        description?: string,
    ): Promise<DeductResult> {
        if (cost <= 0) {
            throw new BadRequestException('Cost must be positive');
        }

        return this.prisma.$transaction(async (tx) => {
            const wallet = await tx.userWallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                throw new NotFoundException(`Wallet not found for user ${userId}`);
            }

            // Calculate total available including grace limit
            const totalAvailable = wallet.subscriptionCredits + wallet.topUpCredits + wallet.graceLimit;
            if (totalAvailable < cost) {
                throw new InsufficientCreditsError(cost, wallet.subscriptionCredits + wallet.topUpCredits);
            }

            // 1. Deduct from subscription wallet first (expiring credits)
            let subscriptionDeducted = 0;
            let topUpDeducted = 0;
            let graceUsed = 0;

            if (wallet.subscriptionCredits > 0) {
                subscriptionDeducted = Math.min(wallet.subscriptionCredits, cost);
            }

            // 2. Remaining cost from top-up wallet
            let remaining = cost - subscriptionDeducted;
            if (remaining > 0 && wallet.topUpCredits > 0) {
                // FIX #11: Only deduct what's actually available in top-up wallet
                topUpDeducted = Math.min(wallet.topUpCredits, remaining);
                remaining -= topUpDeducted;
            }

            // 3. Any remaining cost uses grace limit (but doesn't reduce stored balance below 0)
            if (remaining > 0) {
                graceUsed = remaining;
                // Grace is used but doesn't actually reduce the stored balance
                // The user will need to replenish credits before using more
            }

            // 4. Update wallet balances - ensure they don't go negative
            const newSubscriptionBalance = Math.max(0, wallet.subscriptionCredits - subscriptionDeducted);
            const newTopUpBalance = Math.max(0, wallet.topUpCredits - topUpDeducted);
            // Fix 10: Track grace usage persistently
            const newGraceUsed = wallet.graceUsed + graceUsed;
            const newGraceLimit = Math.max(0, wallet.graceLimit - graceUsed);

            await tx.userWallet.update({
                where: { userId },
                data: {
                    subscriptionCredits: newSubscriptionBalance,
                    topUpCredits: newTopUpBalance,
                    graceLimit: newGraceLimit, // Fix 10: Reduce available grace
                    graceUsed: newGraceUsed,   // Fix 10: Track total grace used
                },
            });

            // 5. Record transactions for audit trail
            if (subscriptionDeducted > 0) {
                await tx.walletTransaction.create({
                    data: {
                        userId,
                        walletType: WalletType.SUBSCRIPTION,
                        transactionType: TransactionType.DEBIT,
                        amount: subscriptionDeducted,
                        balanceBefore: wallet.subscriptionCredits,
                        balanceAfter: newSubscriptionBalance,
                        sourceType,
                        sourceId,
                        description,
                    },
                });
            }

            if (topUpDeducted > 0) {
                await tx.walletTransaction.create({
                    data: {
                        userId,
                        walletType: WalletType.TOPUP,
                        transactionType: TransactionType.DEBIT,
                        amount: topUpDeducted,
                        balanceBefore: wallet.topUpCredits,
                        balanceAfter: newTopUpBalance,
                        sourceType,
                        sourceId,
                        description,
                    },
                });
            }

            // Log grace usage separately (doesn't reduce stored balance)
            if (graceUsed > 0) {
                await tx.walletTransaction.create({
                    data: {
                        userId,
                        walletType: WalletType.TOPUP, // Grace is tracked against top-up
                        transactionType: TransactionType.DEBIT,
                        amount: graceUsed,
                        balanceBefore: newTopUpBalance,
                        balanceAfter: newTopUpBalance, // Balance unchanged, grace is a "loan"
                        sourceType,
                        sourceId,
                        description: `${description || 'Usage'} (grace: ${graceUsed} credits)`,
                        metadata: { graceUsed: true, graceAmount: graceUsed } as any,
                    },
                });
                this.logger.warn(
                    `User ${userId} used ${graceUsed} grace credits. Balance is now ${newSubscriptionBalance + newTopUpBalance} but they spent ${cost} total.`,
                );
            }

            // 6. Sync legacy credits field for backward compatibility
            await this.syncLegacyCredits(tx, userId, newSubscriptionBalance, newTopUpBalance);

            this.logger.log(
                `Deducted ${cost} credits from user ${userId}: ${subscriptionDeducted} from subscription, ${topUpDeducted} from top-up${graceUsed > 0 ? `, ${graceUsed} from grace` : ''}`,
            );

            return {
                subscriptionDeducted,
                topUpDeducted,
                totalDeducted: cost,
                newSubscriptionBalance,
                newTopUpBalance,
            };
        });
    }


    /**
     * Add credits to top-up wallet (one-time purchases)
     */
    async addTopUpCredits(
        userId: string,
        amount: number,
        sourceId: string,
        description?: string,
    ): Promise<void> {
        if (amount <= 0) {
            throw new BadRequestException('Amount must be positive');
        }

        await this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWalletInTx(tx, userId);

            const newBalance = wallet.topUpCredits + amount;

            await tx.userWallet.update({
                where: { userId },
                data: { topUpCredits: newBalance },
            });

            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletType: WalletType.TOPUP,
                    transactionType: TransactionType.CREDIT,
                    amount,
                    balanceBefore: wallet.topUpCredits,
                    balanceAfter: newBalance,
                    sourceType: 'PAYMENT',
                    sourceId,
                    description: description || 'Top-up purchase',
                },
            });

            // Sync legacy credits
            await this.syncLegacyCredits(tx, userId, wallet.subscriptionCredits, newBalance);
        });

        this.logger.log(`Added ${amount} top-up credits to user ${userId}`);
    }

    /**
     * Reset subscription credits (called on billing cycle renewal)
     * This is a RESET, not an ADD - previous subscription credits are wiped
     */
    async resetSubscriptionCredits(
        userId: string,
        planLimit: number,
        expiresAt: Date,
        sourceId?: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWalletInTx(tx, userId);

            const oldBalance = wallet.subscriptionCredits;
            const newBalance = planLimit;

            await tx.userWallet.update({
                where: { userId },
                data: {
                    subscriptionCredits: newBalance,
                    subscriptionExpiresAt: expiresAt,
                },
            });

            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletType: WalletType.SUBSCRIPTION,
                    transactionType: TransactionType.RESET,
                    amount: newBalance,
                    balanceBefore: oldBalance,
                    balanceAfter: newBalance,
                    sourceType: 'SUBSCRIPTION_CYCLE',
                    sourceId,
                    description: `Subscription reset to ${planLimit} credits`,
                    metadata: {
                        planLimit,
                        expiredCredits: oldBalance,
                    } as Prisma.InputJsonValue,
                },
            });

            // Sync legacy credits
            await this.syncLegacyCredits(tx, userId, newBalance, wallet.topUpCredits);
        });

        this.logger.log(`Reset subscription credits for user ${userId} to ${planLimit} (expires: ${expiresAt.toISOString()})`);
    }

    /**
     * Revoke subscription credits (called on payment failure)
     * Sets subscription credits to 0 and records the revocation
     */
    async revokeSubscriptionCredits(
        userId: string,
        reason: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.userWallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                throw new NotFoundException(`Wallet not found for user ${userId}`);
            }

            const oldBalance = wallet.subscriptionCredits;

            // Only revoke if there are credits to revoke
            if (oldBalance <= 0) {
                this.logger.log(`No subscription credits to revoke for user ${userId}`);
                return;
            }

            await tx.userWallet.update({
                where: { userId },
                data: {
                    subscriptionCredits: 0,
                    subscriptionExpiresAt: null,
                },
            });

            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletType: WalletType.SUBSCRIPTION,
                    transactionType: TransactionType.DEBIT,
                    amount: oldBalance,
                    balanceBefore: oldBalance,
                    balanceAfter: 0,
                    sourceType: 'SYSTEM',
                    description: `Credits revoked: ${reason}`,
                    metadata: {
                        revocationReason: reason,
                    } as Prisma.InputJsonValue,
                },
            });

            // Sync legacy credits
            await this.syncLegacyCredits(tx, userId, 0, wallet.topUpCredits);
        });

        this.logger.log(`Revoked all subscription credits for user ${userId}. Reason: ${reason}`);
    }

    /**
     * Grant initial subscription credits (first subscription purchase)
     */
    async grantInitialSubscriptionCredits(
        userId: string,
        planCredits: number,
        expiresAt: Date,
        sourceId?: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWalletInTx(tx, userId);

            await tx.userWallet.update({
                where: { userId },
                data: {
                    subscriptionCredits: planCredits,
                    subscriptionExpiresAt: expiresAt,
                },
            });

            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletType: WalletType.SUBSCRIPTION,
                    transactionType: TransactionType.CREDIT,
                    amount: planCredits,
                    balanceBefore: wallet.subscriptionCredits,
                    balanceAfter: planCredits,
                    sourceType: 'SUBSCRIPTION_CYCLE',
                    sourceId,
                    description: 'Initial subscription credits',
                },
            });

            // Sync legacy credits
            await this.syncLegacyCredits(tx, userId, planCredits, wallet.topUpCredits);
        });

        this.logger.log(`Granted ${planCredits} initial subscription credits to user ${userId}`);
    }

    /**
     * Refund credits to the appropriate wallet
     */
    async refundCredits(
        userId: string,
        amount: number,
        originalWalletType: WalletType,
        reason: string,
        sourceId?: string,
    ): Promise<void> {
        if (amount <= 0) {
            return;
        }

        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.userWallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                throw new NotFoundException(`Wallet not found for user ${userId}`);
            }

            const field = originalWalletType === WalletType.SUBSCRIPTION ? 'subscriptionCredits' : 'topUpCredits';
            const oldBalance = wallet[field];
            const newBalance = oldBalance + amount;

            await tx.userWallet.update({
                where: { userId },
                data: { [field]: newBalance },
            });

            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletType: originalWalletType,
                    transactionType: TransactionType.REFUND,
                    amount,
                    balanceBefore: oldBalance,
                    balanceAfter: newBalance,
                    sourceType: 'SYSTEM',
                    sourceId,
                    description: reason,
                },
            });

            // Sync legacy credits
            const syncSubCredits = originalWalletType === WalletType.SUBSCRIPTION ? newBalance : wallet.subscriptionCredits;
            const syncTopUpCredits = originalWalletType === WalletType.TOPUP ? newBalance : wallet.topUpCredits;
            await this.syncLegacyCredits(tx, userId, syncSubCredits, syncTopUpCredits);
        });

        this.logger.log(`Refunded ${amount} credits to user ${userId} (${originalWalletType} wallet). Reason: ${reason}`);
    }

    /**
     * Check if user has sufficient credits
     */
    async hasCredits(userId: string, cost: number): Promise<boolean> {
        const wallet = await this.getOrCreateWallet(userId);
        const totalAvailable = wallet.subscriptionCredits + wallet.topUpCredits + wallet.graceLimit;
        return totalAvailable >= cost;
    }

    /**
     * Get transaction history for a user
     */
    async getTransactionHistory(userId: string, limit: number = 50) {
        return this.prisma.walletTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Helper to get or create wallet within a transaction
     */
    private async getOrCreateWalletInTx(
        tx: Prisma.TransactionClient,
        userId: string,
    ) {
        let wallet = await tx.userWallet.findUnique({
            where: { userId },
        });

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

        return wallet;
    }
}
