
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL,
        },
    },
});

async function main() {
    console.log('Checking for active locks/queries...');
    try {
        const result = await prisma.$queryRaw`
      SELECT pid, state, query, wait_event_type, wait_event, usename, client_addr 
      FROM pg_stat_activity 
      WHERE state != 'idle' AND pid != pg_backend_pid();
    `;
        console.log('Active queries:', result);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
