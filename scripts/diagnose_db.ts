import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Fetching active queries...');
        const result = await prisma.$queryRaw`
            SELECT pid, state, query_start, query 
            FROM pg_stat_activity 
            WHERE state = 'active'
            AND pid <> pg_backend_pid();
        `;
        console.log('Active queries:', JSON.stringify(result, null, 2));

        console.log('Fetching locks...');
        // Simple lock check (optional complexity)
        const locks = await prisma.$queryRaw`
            SELECT pid, mode, granted 
            FROM pg_locks 
            WHERE granted = false;
        `;
        console.log('Waiting locks:', JSON.stringify(locks, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Diagnosis FAILED:', e);
        process.exit(1);
    }
}

main();
