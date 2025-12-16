
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL,
        },
    },
});

async function main() {
    console.log('Connecting...');
    try {
        await prisma.$connect();
        console.log('Connected.');
        const result = await prisma.$queryRaw`SELECT 1 as result`;
        console.log('Query Result:', result);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
