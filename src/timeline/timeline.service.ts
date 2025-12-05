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

        const job = await this.prisma.job.findUnique({ where: { id: jobId } });
        if (!job || job.status !== 'PROCESSING') return;

        const metadata: any = job.metadata || {};
        const segments = metadata.segments || [];
        const index = parseInt(segmentIndex);

        if (segments[index]) {
            if (payload.status === 'succeeded') {
                // Kling output is usually an array of strings (URLs)
                const videoUrl = Array.isArray(payload.output) ? payload.output[0] : payload.output;
                segments[index].videoUrl = videoUrl;
                segments[index].status = 'completed';
                this.logger.log(`Segment ${index} video generated: ${videoUrl}`);
            } else if (payload.status === 'failed' || payload.status === 'canceled') {
                segments[index].status = 'failed';
                segments[index].error = payload.error;
                this.logger.error(`Segment ${index} video failed: ${payload.error}`);
            }
        }

        // Update job metadata
        await this.prisma.job.update({
            where: { id: jobId },
            data: { metadata: { ...metadata, segments } }
        });

        // Check if all segments are done (completed, failed, or skipped)
        // We only wait for segments that have a predictionId (i.e., video generation started)
        // Segments without video (skipped) should be marked as such initially.
        const pending = segments.some((s: any) => s.status === 'generating');
        if (!pending) {
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
            const script = await this.generateScript(dto.topic, dto.style, dto.duration);
            this.logger.log(`Generated script with ${script.length} segments`);

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
                    }, { cost: 1, isJob: true }).catch(err => {
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
                    return { item, index, error: true, status: 'failed' };
                }
            });

            const preparedSegments = await Promise.all(segmentPromises);

            // 4. Start Async Video Generation
            const webhookHost = this.configService.get<string>('WEBHOOK_HOST');
            if (!webhookHost) {
                this.logger.warn('WEBHOOK_HOST not set. Video generation might fail or not report back if using async.');
            }

            const segmentsMetadata: any[] = [];

            for (const segment of preparedSegments) {
                if (segment.status === 'failed' || !segment.imageUrl) {
                    segmentsMetadata.push({ ...segment, status: 'failed' });
                    continue;
                }

                let predictionId = null;
                let status = 'skipped';

                if (webhookHost) {
                    try {
                        const webhookUrl = `${webhookHost}/api/webhooks/replicate?jobId=${job.id}&segmentIndex=${segment.index}`;
                        const prediction = await this.klingProvider.generateVideoFromImageAsync(
                            segment.imageUrl,
                            segment.item.visualPrompt,
                            webhookUrl
                        );
                        predictionId = prediction.id;
                        status = 'generating';
                    } catch (err) {
                        this.logger.error(`Failed to start video generation for segment ${segment.index}`, err);
                        status = 'failed';
                    }
                } else {
                    // Fallback to sync if no webhook host (or just fail/skip video)
                    // For now, we'll mark as skipped or try sync if we wanted, but the goal is async.
                    // We will just skip video generation if no webhook host is configured to avoid hanging.
                    this.logger.warn(`Skipping video generation for segment ${segment.index} due to missing WEBHOOK_HOST`);
                }

                segmentsMetadata.push({
                    ...segment,
                    predictionId,
                    status
                });
            }

            // Save initial state
            await this.prisma.job.update({
                where: { id: job.id },
                data: {
                    metadata: {
                        ...job.metadata,
                        segments: segmentsMetadata,
                        musicUrl,
                        beatTimes,
                        dto // Store DTO for finalization
                    }
                }
            });

            // If no videos are generating (e.g. all failed or no webhook host), finalize immediately
            const anyGenerating = segmentsMetadata.some(s => s.status === 'generating');
            if (!anyGenerating) {
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
        const segmentsData = metadata.segments || [];
        const beatTimes = metadata.beatTimes || [];
        const musicUrl = metadata.musicUrl;
        const dto = metadata.dto || {};

        const segments: TimelineSegment[] = [];
        let currentTime = 0;

        for (const data of segmentsData) {
            if (data.status === 'failed' && !data.imageUrl) continue; // Skip completely failed segments

            const { item, voiceUrl, audioDuration, imageUrl, videoUrl } = data;
            let duration: number;
            let endTime: number;

            if (dto.includeNarration !== false && audioDuration) {
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
                index: segments.length,
                script: item.text,
                visualPrompt: item.visualPrompt,
                voiceUrl: voiceUrl,
                imageUrl: imageUrl || undefined,
                videoUrl: videoUrl || undefined,
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

    private async generateScript(topic: string, style: string, duration: 'short' | 'medium' | 'long' = 'medium'): Promise<{ text: string; visualPrompt: string }[]> {
        const modelId = this.configService.get<string>('REPLICATE_MODEL_ID') || 'openai/gpt-5';

        const segmentCounts = {
            short: 3,
            medium: 6,
            long: 12
        };
        const targetSegments = segmentCounts[duration] || 6;

        const prompt = `
      Generate a script for a viral TikTok video about "${topic}".
      Style: ${style}.
      Target Length: ${duration} (${targetSegments} segments).
      
      NOTE: We are using the ElevenLabs v3 model for speech synthesis. This model supports advanced audio tags for emotional control and sound effects.
      
      Please incorporate the following tags naturally into the "text" where appropriate to enhance the storytelling:
      - Emotion: [laughs], [laughs harder], [whispers], [sighs], [exhales], [crying], [excited], [sarcastic], [curious]
      - Pacing: [pause] (e.g. "Wait... [pause] did you hear that?")
      
      Guidelines for "text":
      - Write in a natural, conversational, or narrative style.
      - Use the tags to add life to the script (e.g., "[whispers] I have a secret to tell you.", "This is amazing! [laughs]").
      - Do NOT overuse tags; use them effectively for emphasis.
      
      The output must be a JSON array of EXACTLY ${targetSegments} objects, where each object has:
      - "text": The spoken narration for this segment (including tags).
      - "visualPrompt": A cinematic, detailed visual description for an AI image generator.
      
      Keep it punchy and engaging.
      IMPORTANT: Return ONLY the raw JSON array. Do not include markdown formatting like \`\`\`json or \`\`\`.
    `;

        try {
            const output = await this.replicate.run(modelId as any, {
                input: {
                    prompt: prompt,
                    max_tokens: 1024,
                    temperature: 0.7,
                    system_prompt: "You are a creative scriptwriter. You always output valid JSON arrays. You never add markdown formatting or explanations."
                }
            });

            // Replicate output for Llama 3 is usually an array of strings (tokens) or a single string depending on stream settings.
            // The SDK usually returns the full output if not streaming.
            // If it returns an array of strings, we join them.
            const content = Array.isArray(output) ? output.join('') : (typeof output === 'object' ? JSON.stringify(output) : String(output));

            this.logger.debug(`Replicate output: ${content.substring(0, 100)}...`);

            // Clean up potential markdown code blocks if the model ignores instructions
            const cleanedContent = content.replace(/```json/g, '').replace(/```/g, '').trim();

            const parsed = JSON.parse(cleanedContent);

            // Handle cases where the array might be wrapped in a key like "segments" or just be the array
            if (Array.isArray(parsed)) return parsed;
            if (parsed.script && Array.isArray(parsed.script)) return parsed.script;
            if (parsed.segments && Array.isArray(parsed.segments)) return parsed.segments;

            const values = Object.values(parsed);
            const arrayVal = values.find(v => Array.isArray(v));
            if (arrayVal) return arrayVal as any;

            throw new Error('Could not find array in JSON response');
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
}
