
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Backfilling User.id with authUserId...');

    // Update all users where id is null to have id = authUserId
    // Since we are using raw SQL, we can do this efficiently
    // Note: "User" table name is usually quoted in Postgres
    const result = await prisma.$executeRawUnsafe(`
    UPDATE "User" 
    SET "id" = "authUserId" 
    WHERE "id" IS NULL
  `);

    console.log(`Updated ${result} users.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
