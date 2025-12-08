// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { exec } from 'child_process';
import * as util from 'util';
import * as dotenv from 'dotenv';
import { TimelineSegment } from './src/timeline/dto/timeline-response.dto';

dotenv.config();

const execAsync = util.promisify(exec);
const prisma = new PrismaClient();

const TARGET_JOB_ID = 'cmixmwn2j0001s601mnmz1ill'; // Hardcoded for this task

async function main() {
    console.log(`Fetching Job ID: ${TARGET_JOB_ID}...`);
    const job = await prisma.job.findUnique({
        where: { id: TARGET_JOB_ID },
    });

    if (!job) {
        console.error(`Job ${TARGET_JOB_ID} not found.`);
        process.exit(1);
    }
    console.log(`Found Job: ${job.id}, Status: ${job.status}`);

    const segments = await prisma.timelineSegment.findMany({
        where: { jobId: job.id },
        orderBy: { index: 'asc' },
    });

    // We might want to stitch even if status is not 'completed' locally if we want to debug, 
    // but usually only completed segments have videoUrl.
    const validSegments = segments.filter(s => s.videoUrl);
    console.log(`Found ${validSegments.length} valid segments (with videoUrl).`);

    validSegments.forEach(s => {
        console.log(`Seg ${s.index}: VideoURL=${s.videoUrl}`);
    });

    if (validSegments.length === 0) {
        console.error("No valid segments found.");
        process.exit(1);
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `manual-stitch-${job.id}-`));
    console.log(`Temp dir: ${tempDir}`);

    const manifest: any[] = [];

    for (const seg of validSegments) {
        const vExt = path.extname(seg.videoUrl!) || '.mp4';
        const localVideoPath = path.join(tempDir, `seg-${seg.index}-video${vExt}`);

        console.log(`Downloading Seg ${seg.index} VIDEO...`);
        await downloadFile(seg.videoUrl!, localVideoPath);

        const localAudioPath = path.join(tempDir, `seg-${seg.index}-audio.mp3`);

        // Handle Audio
        if (seg.audioUrl) {
            console.log(`Downloading Seg ${seg.index} AUDIO...`);
            await downloadFile(seg.audioUrl, localAudioPath);
        } else {
            console.log(`Generating Silent Audio for Seg ${seg.index}...`);
            await execAsync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -c:a libmp3lame -q:a 4 "${localAudioPath}"`);
        }

        // Handle Alignment
        let alignment = (seg as any).alignment;

        // If no alignment, try to fetch (optional, copied from test script but maybe not needed if we just want to stitch what we have)
        if (!alignment && seg.script) {
            console.log(`  -> No alignment in DB for seg ${seg.index}, attempting to fetch from ElevenLabs (Optional)...`);
            try {
                const apiKey = process.env.ELEVENLABS_API_KEY;
                if (apiKey) {
                    const cleanText = (seg.script || '').replace(/\[.*?\]/g, '').trim();
                    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps`, {
                        method: 'POST',
                        headers: {
                            'xi-api-key': apiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            text: cleanText,
                            model_id: "eleven_multilingual_v2",
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                        })
                    });

                    if (resp.ok) {
                        const data = await resp.json();
                        alignment = data.alignment;
                        const audioBase64 = data.audio_base64;
                        fs.writeFileSync(localAudioPath, Buffer.from(audioBase64, 'base64'));
                        console.log(`  -> Got alignment & new audio`);
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch alignment, proceeding without it.");
            }
        }

        manifest.push({
            video: localVideoPath,
            audio: localAudioPath,
            text: seg.script || '',
            alignment: alignment
        });
    }

    // Music
    const metadata: any = job.metadata || {};
    let localMusicPath = undefined;
    if (metadata.musicUrl) {
        console.log(`Downloading Background Music...`);
        const ext = path.extname(metadata.musicUrl) || '.mp3';
        localMusicPath = path.join(tempDir, `music${ext}`);
        await downloadFile(metadata.musicUrl, localMusicPath);
    }

    const manifestPath = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const outputPath = path.join(process.cwd(), `stitched_${job.id}.mp4`); // Output in current dir
    const scriptPath = path.resolve('scripts/stitch_clips.py');

    // Default font settings
    const cmd = `python3 "${scriptPath}" --clips "${manifestPath}" --output "${outputPath}" --format "9:16"${localMusicPath ? ` --audio "${localMusicPath}"` : ''} --fontsize 80 --color yellow --y_pos "(h-text_h)/1.15"`;
    console.log(`Running Stitcher: ${cmd}`);

    try {
        const { stdout, stderr } = await execAsync(cmd);
        console.log("--- STITCHER OUTPUT ---");
        console.log(stdout);
        if (stderr) console.error(stderr);
        console.log(`\nSUCCESS! Output saved to: ${outputPath}`);
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
