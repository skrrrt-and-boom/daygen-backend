
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Debug Credit Check (Recent Items) ---');

    console.log('\n--- Recent Subscriptions (Last 5) ---');
    const subs = await prisma.subscription.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    for (const s of subs) {
        console.log(`ID: ${s.id} | User: ${s.userId} | Status: ${s.status} | Credits: ${s.credits} | CreditsGranted: ${s.creditsGranted} | StripeSub: ${s.stripeSubscriptionId} | PriceID: ${s.stripePriceId}`);
    }

    console.log('\n--- Recent Users (Last 5) ---');
    const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    for (const u of users) {
        console.log(`ID: ${u.id} | AuthID: ${u.authUserId} | Credits: ${u.credits} | StripeCust: ${u.stripeCustomerId}`);
        // Check wallet for this user
        await checkUser(u.authUserId);
    }
}

async function checkUser(userId: string) {
    console.log(`\nChecking User: ${userId}`);

    const wallet = await prisma.userWallet.findUnique({ where: { userId } });
    console.log('UserWallet:', wallet);

    const user = await prisma.user.findUnique({ where: { authUserId: userId } });
    console.log('User (Legacy):', user?.credits);

    const transactions = await prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    console.log('\nRecent Transactions:');
    transactions.forEach(t => {
        console.log(`${t.createdAt.toISOString()} | ${t.walletType}:${t.transactionType} | ${t.amount} | ${t.description} | BalanceAfter: ${t.balanceAfter}`);
    });

    // Check pending/completed payments
    const payments = await prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log('\nRecent Payments:');
    payments.forEach(p => {
        console.log(`${p.createdAt.toISOString()} | ${p.amount} | ${p.status} | Credits: ${p.credits} | Session: ${p.stripeSessionId}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
