
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL,
        },
    },
});

async function main() {
    console.log('Starting manual fix...');
    try {
        console.log('1. Adding column id...');
        await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "id" TEXT;`);

        // Check if unique constraint exists, if not add it
        // For simplicity, just try adding unique index, ignore if fails?
        // Postgres: CREATE UNIQUE INDEX IF NOT EXISTS ...
        console.log('1b. Adding unique index...');
        try {
            await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_id_key" ON "User"("id");`);
        } catch (e) {
            console.log('Index might already exist:', e.message);
        }

        console.log('2. Backfilling data...');
        const result = await prisma.$executeRawUnsafe(`UPDATE "User" SET "id" = "authUserId" WHERE "id" IS NULL;`);
        console.log(`Backfilled ${result} rows.`);

        console.log('3. Setting NOT NULL constraint...');
        await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "id" SET NOT NULL;`);

        console.log('Done successfully.');
    } catch (e) {
        console.error('Error during manual fix:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
