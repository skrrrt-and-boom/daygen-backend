import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationOrchestrator } from '../generation/generation.orchestrator';
import { UsersService } from '../users/users.service';

import { ConfigService } from '@nestjs/config';
import { AudioService } from '../audio/audio.service';
import { MusicService } from '../audio/music.service';
import { R2Service } from '../upload/r2.service';
import { GenerateTimelineDto } from './dto/generate-timeline.dto';
import { TimelineResponse, TimelineSegment } from './dto/timeline-response.dto';
import { KlingProvider } from '../generation/providers/kling.provider';
import { REEL_GENERATOR_SYSTEM_PROMPT } from './timeline.constants';
import Replicate from 'replicate';
import * as util from 'util';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mp3Duration = require('mp3-duration');

const exec = util.promisify(child_process.exec);

@Injectable()
export class TimelineService {
    private readonly logger = new Logger(TimelineService.name);
    private readonly replicate: Replicate;

    constructor(
        private readonly audioService: AudioService,
        private readonly musicService: MusicService,
        private readonly configService: ConfigService,
        private readonly r2Service: R2Service,
        private readonly prisma: PrismaService,
        private readonly generationOrchestrator: GenerationOrchestrator,
        private readonly usersService: UsersService,
        private readonly klingProvider: KlingProvider,
    ) {
        const replicateToken = this.configService.get<string>('REPLICATE_API_TOKEN');
        if (!replicateToken) {
            this.logger.warn('REPLICATE_API_TOKEN not configured');
        }
        this.replicate = new Replicate({ auth: replicateToken });
    }

    async getJobStatus(jobId: string) {
        return this.prisma.job.findUnique({
            where: { id: jobId }
        });
    }

    async createTimeline(dto: GenerateTimelineDto, userId: string): Promise<any> {
        this.logger.log(`Creating timeline for topic: ${dto.topic} for user: ${userId}`);

        const job = await this.prisma.job.create({
            data: {
                userId: userId,
                type: 'CYRAN_ROLL' as any,
                status: 'PROCESSING',
                metadata: { topic: dto.topic, style: dto.style },
                progress: 0
            }
        });

        // Start background processing
        this.processTimelineGeneration(job, dto).catch(err => {
            this.logger.error(`Background generation failed for job ${job.id}`, err);
        });

        return job;
    }

    async handleWebhookUpdate(payload: any, query: any) {
        const { jobId, segmentIndex } = query;
        if (!jobId || segmentIndex === undefined) {
            this.logger.warn('Webhook missing jobId or segmentIndex');
            return;
        }

        const index = parseInt(segmentIndex);

        // Determine status and output
        let status = 'generating';
        let videoUrl: string | undefined = undefined;
        let error: string | undefined = undefined;

        if (payload.status === 'succeeded') {
            const rawVideoUrl = Array.isArray(payload.output) ? payload.output[0] : payload.output;
            if (rawVideoUrl) {
                try {
                    // Upload to R2 (cyran-roll-clips)
                    const buffer = await this.downloadToBuffer(rawVideoUrl);
                    videoUrl = await this.r2Service.uploadBuffer(buffer, 'video/mp4', 'cyran-roll-clips');
                    status = 'completed';
                    this.logger.log(`Segment ${index} video uploaded to R2: ${videoUrl}`);
                } catch (err) {
                    this.logger.error(`Failed to upload video segment ${index} to R2`, err);
                    status = 'failed';
                    error = 'Failed to upload video to storage';
                }
            } else {
                status = 'failed';
                error = 'No video output from provider';
            }
        } else if (payload.status === 'failed' || payload.status === 'canceled') {
            status = 'failed';
            error = payload.error;
            this.logger.error(`Segment ${index} video failed: ${payload.error}`);
        } else {
            // Ignore other statuses (processing, starting)
            return;
        }

        try {
            // Step B1: Update the specific TimelineSegment row
            await this.prisma.timelineSegment.update({
                where: {
                    jobId_index: {
                        jobId,
                        index
                    }
                },
                data: {
                    status,
                    videoUrl,
                    error
                }
            });
        } catch (err) {
            this.logger.error(`Failed to update segment ${index} for job ${jobId}`, err);
            // If segment not found, maybe job deleted?
            return;
        }

        // Step B2: Check for pending segments
        const pendingCount = await this.prisma.timelineSegment.count({
            where: {
                jobId,
                status: 'generating'
            }
        });

        // Step B3: If count is 0, call finalizeJob
        if (pendingCount === 0) {
            this.logger.log(`All segments for job ${jobId} finished. Finalizing...`);
            await this.finalizeJob(jobId);
        }
    }

    private async processTimelineGeneration(job: any, dto: GenerateTimelineDto) {
        try {
            // 0. Fetch User
            const user = await this.usersService.findById(job.userId);
            if (!user) throw new Error('User not found');

            // 1. Script Generation
            const { script, title } = await this.generateScript(dto.topic, dto.style, dto.duration);
            this.logger.log(`Generated script with ${script.length} segments. Title: "${title}"`);

            // 1.5 Update Job Title
            if (title) {
                await this.prisma.job.update({
                    where: { id: job.id },
                    data: {
                        metadata: {
                            ...job.metadata,
                            title: title
                        }
                    }
                });
            }

            // 2. Audio Gen & Beat Sync Setup
            const musicUrl = this.musicService.getBackgroundTrack(dto.style || 'upbeat');
            let beatTimes: number[] = [];
            if (musicUrl) {
                try {
                    beatTimes = await this.analyzeBeats(musicUrl);
                } catch (error) {
                    this.logger.error('Failed to analyze beats', error);
                }
            }

            // 3. Concurrent Generation (Audio & Image)
            this.logger.log('Starting concurrent generation (Audio & Image)...');

            const segmentPromises = script.map(async (item, index) => {
                try {
                    // Audio Generation
                    let speechResult: { url: string; duration: number } | null = null;
                    if (dto.includeNarration !== false) {
                        const result = await this.audioService.generateSpeech({
                            text: item.text,
                            voiceId: dto.voiceId,
                            modelId: 'eleven_v3',
                            stability: 0.5,
                            similarityBoost: 0.75,
                        });
                        const buffer = Buffer.from(result.audioBase64, 'base64');
                        const url = await this.r2Service.uploadBuffer(buffer, 'audio/mpeg', 'generated-audio');
                        const duration = await this.getAudioDuration(buffer);
                        speechResult = { url, duration };
                    }

                    // Visual Generation (Image)
                    const imgRes = await this.generationOrchestrator.generate(user, {
                        model: 'nano-banana-pro',
                        prompt: item.visualPrompt,
                        providerOptions: { aspectRatio: '9:16' }
                    }, {
                        cost: 1,
                        isJob: true,
                        persistenceOptions: {
                            bucket: 'cyran-roll-images',
                            skipR2FileRecord: true
                        }
                    }).catch(err => {
                        this.logger.error(`Visual generation failed for segment ${index}`, err);
                        return null;
                    });

                    const imageUrl = imgRes?.assets?.[0]?.r2FileUrl
                        ?? imgRes?.assets?.[0]?.remoteUrl
                        ?? imgRes?.assets?.[0]?.dataUrl;

                    return {
                        item,
                        index,
                        voiceUrl: speechResult?.url,
                        audioDuration: speechResult?.duration,
                        imageUrl,
                        status: 'ready_for_video'
                    };
                } catch (err) {
                    this.logger.error(`Segment ${index} preparation failed`, err);
                    return { item, index, error: String(err), status: 'failed' };
                }
            });

            const preparedSegments = await Promise.all(segmentPromises);

            // 3.5. Save Segments to DB (Create Phase)
            // We must create them before we try to update them in the next step.
            await this.prisma.timelineSegment.createMany({
                data: preparedSegments.map(seg => ({
                    jobId: job.id,
                    index: seg.index,
                    script: seg.item.text,
                    visualPrompt: seg.item.visualPrompt,
                    audioUrl: (seg as any).voiceUrl,
                    imageUrl: (seg as any).imageUrl,
                    duration: (seg as any).audioDuration,
                    status: seg.status === 'failed' ? 'failed' : 'pending',
                    error: (seg as any).error ? String((seg as any).error) : undefined
                }))
            });

            // 4. Start Video Generation (Sequentially with Smart Retry to survive Rate Limits)
            const webhookHost = this.configService.get<string>('WEBHOOK_HOST');
            if (!webhookHost) {
                this.logger.warn('WEBHOOK_HOST not set. Video generation might fail or not report back if using async.');
            }
            this.logger.log('Starting video generation queue...');

            for (const segment of preparedSegments) {
                if (segment.status === 'failed' || !segment.imageUrl) continue;

                // Save "generating" status to DB (using your new TimelineSegment logic)
                await this.prisma.timelineSegment.update({
                    where: { jobId_index: { jobId: job.id, index: segment.index } },
                    data: { status: 'generating' }
                });

                // Run with retry
                try {
                    const webhookUrl = `${webhookHost}/api/webhooks/replicate?jobId=${job.id}&segmentIndex=${segment.index}`;

                    const prediction = await this.runWithSmartRetry(
                        () => this.klingProvider.generateVideoFromImageAsync(
                            segment.imageUrl!,
                            segment.item.visualPrompt,
                            webhookUrl
                        ),
                        segment.index
                    );

                    // Update DB with prediction ID
                    await this.prisma.timelineSegment.update({
                        where: { jobId_index: { jobId: job.id, index: segment.index } },
                        data: { predictionId: prediction.id }
                    });

                } catch (err) {
                    this.logger.error(`Segment ${segment.index} failed to start video:`, err);
                    await this.prisma.timelineSegment.update({
                        where: { jobId_index: { jobId: job.id, index: segment.index } },
                        data: { status: 'failed', error: String(err) }
                    });
                }
            }

            // Save initial state (musicUrl, beatTimes, dto) but NOT segments in metadata
            await this.prisma.job.update({
                where: { id: job.id },
                data: {
                    metadata: {
                        ...job.metadata,
                        musicUrl,
                        beatTimes,
                        dto
                    }
                }
            });

            // If no videos are generating (e.g. all failed or no webhook host), finalize immediately
            const generatingCount = await this.prisma.timelineSegment.count({
                where: { jobId: job.id, status: 'generating' }
            });
            if (generatingCount === 0) {
                await this.finalizeJob(job.id);
            }

        } catch (error) {
            this.logger.error(`Job ${job.id} failed during initialization`, error);
            await this.prisma.job.update({
                where: { id: job.id },
                data: {
                    status: 'FAILED',
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }

    private async finalizeJob(jobId: string) {
        const job = await this.prisma.job.findUnique({ where: { id: jobId } });
        if (!job) return;

        const metadata: any = job.metadata || {};
        const beatTimes = metadata.beatTimes || [];
        const musicUrl = metadata.musicUrl;
        const dto = metadata.dto || {};

        // Fetch segments from DB
        const dbSegments = await this.prisma.timelineSegment.findMany({
            where: { jobId },
            orderBy: { index: 'asc' }
        });

        const segments: TimelineSegment[] = [];
        let currentTime = 0;

        for (const seg of dbSegments) {
            if (seg.status === 'failed' && !seg.imageUrl) continue;

            const audioDuration = seg.duration || 0;
            let duration: number;
            let endTime: number;

            if (dto.includeNarration !== false && audioDuration > 0) {
                // Narrative Mode Sync
                endTime = currentTime + audioDuration;
                if (beatTimes.length > 0) {
                    const absoluteTarget = currentTime + audioDuration;
                    const nextBeat = beatTimes.find((t: number) => t > absoluteTarget);
                    if (nextBeat) endTime = nextBeat;
                }
                duration = endTime - currentTime;
            } else {
                // Music Mode Sync
                const minDuration = 3.0;
                const targetTime = currentTime + minDuration;

                if (beatTimes.length > 0) {
                    const nextBeat = beatTimes.find((t: number) => t >= targetTime);
                    endTime = nextBeat || (currentTime + minDuration);
                } else {
                    endTime = currentTime + 4.0;
                }
                duration = endTime - currentTime;
            }

            segments.push({
                index: seg.index,
                script: seg.script,
                visualPrompt: seg.visualPrompt,
                voiceUrl: seg.audioUrl || undefined,
                imageUrl: seg.imageUrl || undefined,
                videoUrl: seg.videoUrl || undefined,
                duration: duration,
                startTime: currentTime,
                endTime: endTime,
            });

            currentTime = endTime;
        }

        const response: TimelineResponse = {
            segments,
            totalDuration: currentTime,
            musicUrl,
        };

        await this.prisma.job.update({
            where: { id: job.id },
            data: {
                status: 'COMPLETED',
                resultUrl: 'completed',
                progress: 100,
                metadata: { ...metadata, response }
            }
        });

        this.logger.log(`Job ${jobId} completed successfully.`);
    }

    private async runWithSmartRetry<T>(
        operation: () => Promise<T>,
        segmentIndex: number,
        maxRetries = 3
    ): Promise<T> {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error: any) {
                // Check for Rate Limit (429)
                if (error?.response?.status === 429 || error?.status === 429 || error?.toString().includes('429')) {
                    // Extract wait time from error message or header, default to 10s
                    // Replicate error example: "... limit resets in ~9s"
                    const match = error.message?.match(/resets in ~(\d+)s/);
                    const waitSeconds = match ? parseInt(match[1]) + 2 : 12; // Add 2s buffer

                    this.logger.warn(`Segment ${segmentIndex} throttled (429). Waiting ${waitSeconds}s before retry ${i + 1}/${maxRetries}...`);
                    await new Promise(r => setTimeout(r, waitSeconds * 1000));
                    continue;
                }
                throw error; // Throw other errors immediately
            }
        }
        throw new Error(`Segment ${segmentIndex} failed after ${maxRetries} rate-limit retries`);
    }

    private async generateScript(topic: string, style: string, duration: 'short' | 'medium' | 'long' = 'medium'): Promise<{ script: any[]; title?: string }> {
        const modelId = this.configService.get<string>('REPLICATE_MODEL_ID') || 'openai/gpt-5';

        const durationText = duration === 'short' ? 'Short (2 scenes)' : duration;
        const prompt = `Topic: ${topic}\nStyle: ${style}\nTarget Total Duration: ${durationText}`;

        try {
            const output = await this.replicate.run(modelId as any, {
                input: {
                    prompt: prompt,
                    max_tokens: 2048,
                    temperature: 0.7,
                    system_prompt: REEL_GENERATOR_SYSTEM_PROMPT
                }
            });

            // Replicate output for Llama 3 is usually an array of strings (tokens) or a single string depending on stream settings.
            // The SDK usually returns the full output if not streaming.
            // If it returns an array of strings, we join them.
            const content = Array.isArray(output) ? output.join('') : (typeof output === 'object' ? JSON.stringify(output) : String(output));

            this.logger.debug(`Replicate output: ${content.substring(0, 100)}...`);

            // Clean up potential markdown code blocks if the model ignores instructions
            const cleanedContent = content.replace(/```json/g, '').replace(/```/g, '').trim();

            let parsed: any;
            try {
                parsed = JSON.parse(cleanedContent);
            } catch (e) {
                // Sometimes the model might add text before or after JSON
                const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw e;
                }
            }

            // Handle cases where the array might be wrapped in a key like "scenes"
            if (parsed.scenes && Array.isArray(parsed.scenes)) {
                return {
                    script: parsed.scenes.map((s: any) => ({
                        ...s,
                        visualPrompt: s.visual_prompt, // Map for compatibility
                        motionPrompt: s.motion_prompt
                    })),
                    title: parsed.meta?.title || parsed.title
                };
            }

            // Fallbacks for older formats or unexpected structures
            if (Array.isArray(parsed)) return { script: parsed };
            if (parsed.script && Array.isArray(parsed.script)) return { script: parsed.script, title: parsed.title };
            if (parsed.segments && Array.isArray(parsed.segments)) return { script: parsed.segments, title: parsed.title };

            const values = Object.values(parsed);
            const arrayVal = values.find(v => Array.isArray(v));
            if (arrayVal) return { script: arrayVal as any };

            throw new Error('Could not find scenes array in JSON response');
        } catch (e) {
            this.logger.error('Failed to generate/parse script from Replicate', e);
            throw new InternalServerErrorException(`Script generation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async getAudioDuration(buffer: Buffer): Promise<number> {
        return new Promise((resolve, reject) => {
            mp3Duration(buffer, (err: any, duration: number) => {
                if (err) return reject(err instanceof Error ? err : new Error(String(err)));
                resolve(duration);
            });
        });
    }

    // Helper method to spawn python script
    async calculateDurations(musicUrl: string): Promise<number[]> {
        return this.analyzeBeats(musicUrl);
    }

    private async analyzeBeats(musicUrl: string): Promise<number[]> {
        // We need to download the file first because the python script likely takes a file path
        // Or we can pass the URL if the script supports it. The script uses librosa.load.
        // librosa.load supports URLs if ffmpeg is installed and configured correctly, but often it's safer to download to temp.

        const tempFile = path.join(os.tmpdir(), `beat-analysis-${Date.now()}.mp3`);

        try {
            // Download file
            // Since we don't have a generic http service injected, we can use fetch or axios.
            // I'll use fetch since node 18+ supports it, or I can use the one from dependencies if available.
            // package.json has "node-fetch": "^2.7.0" and "axios". I'll use axios or fetch.
            // Let's use standard fetch if available or just curl via exec if lazy, but better to use code.
            // I'll use a simple fetch helper.

            await this.downloadFile(musicUrl, tempFile);

            const scriptPath = path.resolve(process.cwd(), 'scripts/analyze_beats.py');
            const { stdout, stderr } = await exec(`python3 "${scriptPath}" "${tempFile}"`);

            if (stderr) {
                // librosa often outputs warnings to stderr, so we shouldn't treat all stderr as failure.
                // But if it fails, it usually exits with non-zero code which exec throws.
                this.logger.debug(`Beat analysis stderr: ${stderr}`);
            }

            const beatTimes = JSON.parse(stdout.trim());
            if (!Array.isArray(beatTimes)) {
                throw new Error('Invalid output format from beat analysis script');
            }

            return beatTimes;

        } catch (error) {
            this.logger.error('Error analyzing beats', error);
            throw error;
        } finally {
            // Cleanup
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        }
    }

    private async downloadFile(url: string, dest: string): Promise<void> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(dest, Buffer.from(arrayBuffer));
    }

    private async downloadToBuffer(url: string): Promise<Buffer> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
}
