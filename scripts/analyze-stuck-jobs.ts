import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeStuckJobs() {
    console.log('\n=== STUCK JOBS ANALYSIS ===\n');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Find stuck jobs
    const stuckJobs = await prisma.job.findMany({
        where: {
            status: 'PROCESSING',
            updatedAt: { lt: fiveMinutesAgo }
        },
        include: {
            timelineSegments: {
                orderBy: { index: 'asc' }
            },
            user: { select: { email: true } }
        },
        take: 10
    });

    console.log(`Found ${stuckJobs.length} stuck jobs:\n`);

    for (const job of stuckJobs) {
        const ageMinutes = Math.round((Date.now() - job.updatedAt.getTime()) / 60000);
        console.log(`📌 Job: ${job.id}`);
        console.log(`   Type: ${job.type}`);
        console.log(`   User: ${job.user?.email || 'N/A'}`);
        console.log(`   Created: ${job.createdAt.toISOString()}`);
        console.log(`   Last Update: ${job.updatedAt.toISOString()} (${ageMinutes} min ago)`);
        console.log(`   Segments: ${job.timelineSegments.length}`);

        const statusCounts: Record<string, number> = {};
        for (const seg of job.timelineSegments) {
            statusCounts[seg.status] = (statusCounts[seg.status] || 0) + 1;
        }
        console.log(`   Segment Status: ${JSON.stringify(statusCounts)}`);

        // Find the problematic segment
        for (let i = 0; i < job.timelineSegments.length; i++) {
            const seg = job.timelineSegments[i];
            const segAge = Math.round((Date.now() - seg.updatedAt.getTime()) / 60000);

            if (seg.status === 'pending' || seg.status === 'generating') {
                console.log(`   ⚠️  Segment ${seg.index}: status=${seg.status}, age=${segAge}min`);
                if (seg.error) console.log(`      Error: ${seg.error}`);
                if (seg.status === 'generating' && !seg.predictionId) {
                    console.log(`      ⚠️  No predictionId - generation may have failed to start`);
                }
            }
        }
        console.log('');
    }

    await prisma.$disconnect();
}

analyzeStuckJobs().catch(console.error);
