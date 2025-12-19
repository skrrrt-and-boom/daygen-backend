import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { ConfigService } from '@nestjs/config';

// Configuration constants
const STUCK_JOB_THRESHOLD_MINUTES = 5;
const STALE_JOB_THRESHOLD_MINUTES = 60; // 1 hour
const HANGING_SEGMENT_THRESHOLD_MINUTES = 10;
const MAX_SEGMENT_RETRIES = 3;

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

        const stuckThreshold = new Date(Date.now() - STUCK_JOB_THRESHOLD_MINUTES * 60 * 1000);

        const stuckJobs = await this.prisma.job.findMany({
            where: {
                status: 'PROCESSING',
                updatedAt: { lt: stuckThreshold }
            },
            include: {
                timelineSegments: { orderBy: { index: 'asc' } }
            },
            take: 20
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
        const segments = job.timelineSegments || [];
        const jobAgeMinutes = (Date.now() - new Date(job.updatedAt).getTime()) / 60000;

        // ─────────────────────────────────────────────────────────────────────────
        // 1. AUTO-FAIL: Stale jobs with 0 segments (abandoned during creation)
        // ─────────────────────────────────────────────────────────────────────────
        if (segments.length === 0 && jobAgeMinutes > STALE_JOB_THRESHOLD_MINUTES) {
            this.logger.warn(`Job ${job.id} has 0 segments and is stale (${Math.round(jobAgeMinutes)} min). Marking as FAILED.`);
            await this.prisma.job.update({
                where: { id: job.id },
                data: {
                    status: 'FAILED',
                    error: 'Job creation failed - no segments were generated (Sweeper cleanup)'
                }
            });
            return;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 2. AUTO-FAIL: All segments have failed
        // ─────────────────────────────────────────────────────────────────────────
        if (segments.length > 0) {
            const allFailed = segments.every((s: any) => s.status === 'failed');
            const hasAnyPending = segments.some((s: any) => s.status === 'pending' || s.status === 'generating');

            if (allFailed) {
                this.logger.warn(`Job ${job.id} has all ${segments.length} segments failed. Marking job as FAILED.`);
                await this.prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: 'FAILED',
                        error: 'All segments failed during generation'
                    }
                });
                return;
            }

            // Also fail if most segments failed and remaining are stuck pending (after failed ones)
            const failedCount = segments.filter((s: any) => s.status === 'failed').length;
            const pendingAfterFailed = segments.some((s: any, i: number) => {
                if (s.status !== 'pending') return false;
                // Check if any previous segment failed
                return segments.slice(0, i).some((prev: any) => prev.status === 'failed');
            });

            if (pendingAfterFailed && failedCount > 0 && jobAgeMinutes > STALE_JOB_THRESHOLD_MINUTES) {
                this.logger.warn(`Job ${job.id} has ${failedCount} failed segments with pending segments blocked. Marking as FAILED.`);
                await this.prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: 'FAILED',
                        error: `Pipeline blocked: ${failedCount} segment(s) failed, blocking remaining segments`
                    }
                });
                return;
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 3. RECOVERY: Stuck "Pending" segments (Continuity gap)
        // ─────────────────────────────────────────────────────────────────────────
        for (let i = 0; i < segments.length - 1; i++) {
            const current = segments[i];
            const next = segments[i + 1];

            if (current.status === 'completed' && next.status === 'pending') {
                this.logger.warn(`Job ${job.id}: Segment ${next.index} is stuck pending after Segment ${current.index} completed. Triggering recovery.`);

                if (current.videoUrl) {
                    try {
                        await this.timelineService.checkAndTriggerNextSegment(job.id, current.index, current.videoUrl);
                    } catch (error) {
                        this.logger.error(`Recovery failed for job ${job.id} segment ${next.index}: ${error}`);
                    }
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 4. RETRY: Hanging "Generating" segments with retry mechanism
        // ─────────────────────────────────────────────────────────────────────────
        const hangingThreshold = new Date(Date.now() - HANGING_SEGMENT_THRESHOLD_MINUTES * 60 * 1000);
        const hangingSegments = segments.filter((s: any) =>
            s.status === 'generating' && new Date(s.updatedAt) < hangingThreshold
        );

        for (const seg of hangingSegments) {
            const config = (seg.config as any) || {};
            const retryCount = config.retryCount || 0;

            if (retryCount < MAX_SEGMENT_RETRIES) {
                // Retry the segment
                this.logger.warn(`Job ${job.id}: Segment ${seg.index} timed out. Retrying (attempt ${retryCount + 1}/${MAX_SEGMENT_RETRIES}).`);

                try {
                    // Update retry count and reset to pending for retry
                    await this.prisma.timelineSegment.update({
                        where: { id: seg.id },
                        data: {
                            status: 'pending',
                            config: { ...config, retryCount: retryCount + 1 },
                            error: null,
                            predictionId: null
                        }
                    });

                    // If this segment has an image, re-trigger video generation
                    if (seg.imageUrl) {
                        await this.timelineService['_triggerVideoGeneration'](
                            job.id,
                            seg.index,
                            seg.visualPrompt,
                            seg.motionPrompt,
                            seg.imageUrl
                        );
                    }
                } catch (error) {
                    this.logger.error(`Retry failed for segment ${seg.index}: ${error}`);
                    // If retry setup fails, mark as failed
                    await this.prisma.timelineSegment.update({
                        where: { id: seg.id },
                        data: { status: 'failed', error: `Retry failed: ${error}` }
                    });
                }
            } else {
                // Max retries exceeded - mark as failed
                this.logger.error(`Job ${job.id}: Segment ${seg.index} exceeded max retries (${MAX_SEGMENT_RETRIES}). Marking as failed.`);
                await this.prisma.timelineSegment.update({
                    where: { id: seg.id },
                    data: {
                        status: 'failed',
                        error: `Timed out after ${MAX_SEGMENT_RETRIES} retry attempts (Sweeper)`
                    }
                });
            }
        }
    }

    /**
     * Webhook Event Cleanup:
     * Removes old webhook events to prevent unbounded table growth.
     * Runs daily at 3 AM.
     */
    @Cron('0 3 * * *') // Every day at 3:00 AM
    async cleanupOldWebhookEvents() {
        this.logger.log('Running Webhook Event Cleanup...');

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        try {
            const result = await (this.prisma as any).webhookEvent.deleteMany({
                where: {
                    createdAt: {
                        lt: thirtyDaysAgo,
                    },
                },
            });

            if (result.count > 0) {
                this.logger.log(`Cleaned up ${result.count} old webhook events (older than 30 days).`);
            }
        } catch (error) {
            // Table might not exist or other error - log but don't throw
            this.logger.warn(`Webhook cleanup skipped: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
