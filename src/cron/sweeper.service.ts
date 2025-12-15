import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SweeperService {
    private readonly logger = new Logger(SweeperService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly timelineService: TimelineService,
        private readonly configService: ConfigService
    ) { }

    /**
     * Reliability Sweeper:
     * Checks for Jobs that are stuck in 'PROCESSING' state with pending segments 
     * but haven't had any activity for a while.
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async sweepStuckJobs() {
        this.logger.log('Running Sweeper Job...');

        // Find jobs that are PROCESSING and updated > 5 minutes ago
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const stuckJobs = await this.prisma.job.findMany({
            where: {
                status: 'PROCESSING',
                updatedAt: {
                    lt: fiveMinutesAgo
                }
            },
            take: 10
        });

        if (stuckJobs.length === 0) {
            return;
        }

        this.logger.log(`Found ${stuckJobs.length} potentially stuck jobs.`);

        for (const job of stuckJobs) {
            await this.checkJobHealth(job);
        }
    }

    private async checkJobHealth(job: any) {
        // Check if there are segments in 'generating' state that effectively timed out?
        // Or if we have 'pending' segments that should have been triggered.

        const segments = await this.prisma.timelineSegment.findMany({
            where: { jobId: job.id },
            orderBy: { index: 'asc' }
        });

        // 1. Check for Stuck "Pending" (Continuity gap)
        // If Segment N is 'completed' and Segment N+1 is 'pending' and hasn't started generating.
        for (let i = 0; i < segments.length - 1; i++) {
            const current = segments[i];
            const next = segments[i + 1];

            if (current.status === 'completed' && next.status === 'pending') {
                // If previous finished but next didn't start, try to trigger continuity.
                this.logger.warn(`Job ${job.id}: Segment ${next.index} is stuck in pending after Segment ${current.index} completed. Attempting to trigger.`);

                // We rely on the timeline service to handle the logic. 
                // However, checkAndTriggerNextSegment expects a webhook trigger context.
                // We can construct a "synthetic" trigger or just call the logic directly.

                if (current.videoUrl) {
                    this.logger.log(`Triggering recovery for job ${job.id} segment ${next.index}`);
                    await this.timelineService.checkAndTriggerNextSegment(job.id, current.index, current.videoUrl);
                }
            }
        }

        // 2. Check for Stuck "Generating"
        // If a segment has been 'generating' for too long (> 10 mins), it might have failed without webhook.
        const hangingSegments = segments.filter(s => s.status === 'generating' && s.updatedAt < new Date(Date.now() - 10 * 60 * 1000));
        if (hangingSegments.length > 0) {
            this.logger.error(`Job ${job.id} has ${hangingSegments.length} hanging segments. Marking as failed.`);
            // Optionally fail the segment
            for (const seg of hangingSegments) {
                await this.prisma.timelineSegment.update({
                    where: { id: seg.id },
                    data: { status: 'failed', error: 'Timed out (Sweeper)' }
                });
            }

            // Should we fail the job? Maybe.
        }
    }
}
