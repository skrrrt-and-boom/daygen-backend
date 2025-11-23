const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log('Attempting to add RESERVED to UsageStatus enum...');
    try {
        await prisma.$executeRawUnsafe(`ALTER TYPE "UsageStatus" ADD VALUE IF NOT EXISTS 'RESERVED';`);
        console.log('Successfully added RESERVED to UsageStatus enum.');
    } catch (e) {
        console.error('Error updating enum:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
