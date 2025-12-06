// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { exec } from 'child_process';
import * as util from 'util';
import * as dotenv from 'dotenv';

dotenv.config();

const execAsync = util.promisify(exec);
const prisma = new PrismaClient();

async function main() {
    console.log('Finding latest CYRAN_ROLL job...');
    const job = await prisma.job.findFirst({
        where: { type: 'CYRAN_ROLL' as any },
        orderBy: { createdAt: 'desc' },
    });

    if (!job) {
        console.error('No CYRAN_ROLL job found.');
        process.exit(1);
    }
    console.log(`Found Job ID: ${job.id}`);

    const segments = await prisma.timelineSegment.findMany({
        where: { jobId: job.id },
        orderBy: { index: 'asc' },
    });

    const validSegments = segments.filter(s => s.status === 'completed' && s.videoUrl);
    console.log(`Found ${validSegments.length} valid segments.`);

    // Log URLs to check for duplicates
    validSegments.forEach(s => {
        console.log(`Seg ${s.index}: VideoURL=${s.videoUrl}`);
    });

    if (validSegments.length === 0) process.exit(1);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `test-stitch-${job.id}-`));
    console.log(`Temp dir: ${tempDir}`);

    const manifest: any[] = [];

    for (const seg of validSegments) {
        const vExt = path.extname(seg.videoUrl!) || '.mp4';
        const localVideoPath = path.join(tempDir, `seg-${seg.index}-video${vExt}`);

        await downloadFile(seg.videoUrl!, localVideoPath);
        const stats = fs.statSync(localVideoPath);
        console.log(`Downloaded Seg ${seg.index}: ${localVideoPath}, Size: ${stats.size} bytes`);

        const localAudioPath = path.join(tempDir, `seg-${seg.index}-audio.mp3`);
        if (seg.audioUrl) {
            await downloadFile(seg.audioUrl, localAudioPath);
        } else {
            await execAsync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -c:a libmp3lame -q:a 4 "${localAudioPath}"`);
        }


        // Re-generate audio to get TIMESTAMPS (Alignment)
        // We do this here locally to emulate the new backend logic for existing jobs
        console.log(`Checking alignment for segment ${seg.index}...`);
        let alignment = (seg as any).alignment;

        if (alignment) {
            console.log(`  -> Found stored alignment in DB (characters: ${alignment.characters?.length})`);
        } else {
            console.log(`  -> No alignment in DB, attempting to fetch from ElevenLabs...`);
            try {
                // Need API Key
                const apiKey = process.env.ELEVENLABS_API_KEY;
                if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

                // Clean text for generation
                const cleanText = (seg.script || '').replace(/\[.*?\]/g, '').trim();

                // Fetch
                const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps`, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: cleanText,
                        model_id: "eleven_multilingual_v2", // or eleven_v3
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                    })
                });

                if (!resp.ok) {
                    console.error("ElevenLabs Error:", await resp.text());
                } else {
                    const data = await resp.json();
                    alignment = data.alignment;
                    const audioBase64 = data.audio_base64;

                    // Overwrite local audio file with this new one (so they match perfectly)
                    fs.writeFileSync(localAudioPath, Buffer.from(audioBase64, 'base64'));
                    console.log(`  -> Got alignment (characters: ${alignment?.characters?.length})`);
                }
            } catch (e) {
                console.error("  -> Failed to fetch alignment:", e);
            }
        }

        manifest.push({
            video: localVideoPath,
            audio: localAudioPath,
            text: seg.script || '',
            alignment: alignment
        });
    }

    const metadata: any = job.metadata || {};
    let localMusicPath = undefined;
    if (metadata.musicUrl) {
        const ext = path.extname(metadata.musicUrl) || '.mp3';
        localMusicPath = path.join(tempDir, `music${ext}`);
        await downloadFile(metadata.musicUrl, localMusicPath);
    }

    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const outputPath = path.join(tempDir, 'final.mp4');
    const scriptPath = path.resolve('scripts/stitch_clips.py');

    const cmd = `python3 "${scriptPath}" --clips "${manifestPath}" --output "${outputPath}" --format "9:16"${localMusicPath ? ` --audio "${localMusicPath}"` : ''} --fontsize 90 --color yellow --y_pos "(h-text_h)/1.15"`;
    console.log(`Running: ${cmd}`);

    try {
        const { stdout, stderr } = await execAsync(cmd);
        console.log(stdout);
        if (stderr) console.error(stderr);
        console.log(`\nSUCCESS! Output: ${outputPath}`);
    } catch (e: any) {
        console.error('Failed:', e.message);
        if (e.stderr) console.error(e.stderr);
    }
}

async function downloadFile(url: string, dest: string) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

main().finally(async () => await prisma.$disconnect());
