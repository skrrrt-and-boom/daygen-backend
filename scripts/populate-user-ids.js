const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function populateUserIds() {
    try {
        // Find users without id
        const usersWithoutId = await prisma.user.findMany({
            where: { id: null },
            select: { authUserId: true }
        });

        console.log(`Found ${usersWithoutId.length} users without id field`);

        // Update each user to set id = authUserId
        for (const user of usersWithoutId) {
            await prisma.user.update({
                where: { authUserId: user.authUserId },
                data: { id: user.authUserId }
            });
            console.log(`Updated user ${user.authUserId}`);
        }

        console.log('✅ All user IDs populated successfully');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

populateUserIds();
