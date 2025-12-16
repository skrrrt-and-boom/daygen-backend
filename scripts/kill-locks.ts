
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL,
        },
    },
});

async function main() {
    const pidsToKill = [3785256, 3785708];

    console.log(`Killing PIDs: ${pidsToKill.join(', ')}`);

    for (const pid of pidsToKill) {
        try {
            // Use pg_terminate_backend
            const result = await prisma.$executeRawUnsafe(`SELECT pg_terminate_backend(${pid});`);
            console.log(`Killed ${pid}:`, result);
        } catch (e) {
            console.error(`Failed to kill ${pid}:`, e.message);
        }
    }

    // Also kill any other sessions that might be blocking (optional, verify first)
    // For now, these are the main culprits.
}

main();
