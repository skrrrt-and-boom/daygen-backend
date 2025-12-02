import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { ConfigService } from '@nestjs/config';
import { AudioService } from '../audio/audio.service';
import { MusicService } from '../audio/music.service';
import { R2Service } from '../upload/r2.service';
import { GenerateTimelineDto } from './dto/generate-timeline.dto';
import { TimelineResponse, TimelineSegment } from './dto/timeline-response.dto';
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

    private async processTimelineGeneration(job: any, dto: GenerateTimelineDto) {
        try {
            // 1. Script Generation
            const script = await this.generateScript(dto.topic, dto.style);
            this.logger.log(`Generated script with ${script.length} segments`);

            const segments: TimelineSegment[] = [];
            let currentTime = 0;

            // 2. Audio Gen & Beat Sync
            const musicUrl = this.musicService.getBackgroundTrack(dto.style || 'upbeat');
            let beatTimes: number[] = [];
            if (musicUrl) {
                try {
                    beatTimes = await this.analyzeBeats(musicUrl);
                } catch (error) {
                    this.logger.error('Failed to analyze beats', error);
                }
            }

            for (let i = 0; i < script.length; i++) {
                const item = script[i];
                let voiceUrl: string | undefined;
                let duration: number;
                let endTime: number;

                if (dto.includeNarration !== false) {
                    // Narrative Mode
                    const speechResult = await this.audioService.generateSpeech({
                        text: item.text,
                        voiceId: dto.voiceId,
                        stability: 0.5,
                        similarityBoost: 0.75,
                    });

                    // Upload Audio
                    const buffer = Buffer.from(speechResult.audioBase64, 'base64');
                    voiceUrl = await this.r2Service.uploadBuffer(
                        buffer,
                        'audio/mpeg',
                        'generated-audio'
                    );

                    // Duration
                    const voiceDuration = await this.getAudioDuration(buffer);

                    // Sync
                    endTime = currentTime + voiceDuration;
                    if (beatTimes.length > 0) {
                        const absoluteTarget = currentTime + voiceDuration;
                        const nextBeat = beatTimes.find(t => t > absoluteTarget);
                        if (nextBeat) endTime = nextBeat;
                    }
                    duration = endTime - currentTime;
                } else {
                    // Music Mode (No Text)
                    // Sync strictly to beats or default duration
                    const minDuration = 3.0; // Minimum segment duration
                    const targetTime = currentTime + minDuration;

                    if (beatTimes.length > 0) {
                        const nextBeat = beatTimes.find(t => t >= targetTime);
                        endTime = nextBeat || (currentTime + minDuration);
                    } else {
                        endTime = currentTime + 4.0; // Default fallback
                    }
                    duration = endTime - currentTime;
                }

                segments.push({
                    index: i,
                    script: item.text,
                    visualPrompt: item.visualPrompt,
                    voiceUrl: voiceUrl, // Can be undefined
                    duration: duration,
                    startTime: currentTime,
                    endTime: endTime,
                });

                currentTime = endTime;

                // Update Progress
                const progress = Math.round(((i + 1) / script.length) * 100);
                await this.prisma.job.update({
                    where: { id: job.id },
                    data: { progress }
                });
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
                    resultUrl: 'completed', // Placeholder or upload JSON to R2
                    metadata: { ...job.metadata, response }
                }
            });

        } catch (error) {
            await this.prisma.job.update({
                where: { id: job.id },
                data: {
                    status: 'FAILED',
                    error: error instanceof Error ? error.message : String(error)
                }
            });
            throw error;
        }
    }

    private async generateScript(topic: string, style: string): Promise<{ text: string; visualPrompt: string }[]> {
        const modelId = this.configService.get<string>('REPLICATE_MODEL_ID') || 'openai/gpt-5';

        const prompt = `
      Generate a script for a viral TikTok video about "${topic}".
      Style: ${style}.
      The output must be a JSON array of objects, where each object has:
      - "text": The spoken narration for this segment.
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
