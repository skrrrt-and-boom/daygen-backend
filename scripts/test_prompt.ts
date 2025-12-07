import 'dotenv/config';
import * as dotenv from 'dotenv';
import Replicate from 'replicate';
import * as path from 'path';
import * as fs from 'fs';
import { REEL_GENERATOR_SYSTEM_PROMPT } from '../src/timeline/timeline.constants';

// Load .env.image-services specifically
dotenv.config({ path: '.env.image-services' });

// Debug: Check if .env.image-services exists and is loaded
const envPath = path.resolve(process.cwd(), '.env.image-services');
console.log(`Checking for .env.image-services at: ${envPath}`);
if (fs.existsSync(envPath)) {
    console.log('.env.image-services file exists.');
} else {
    console.warn('WARNING: .env.image-services file NOT found in current directory.');
}

const token = process.env.REPLICATE_API_TOKEN;
console.log(`REPLICATE_API_TOKEN status: ${token ? 'PRESENT (' + token.substring(0, 4) + '...)' : 'MISSING'}`);

if (!token) {
    console.error('ERROR: Missing REPLICATE_API_TOKEN. Please ensure it is set in .env.image-services or .env');
    process.exit(1);
}

const replicate = new Replicate({
    auth: token,
});

async function main() {
    const topic = process.argv[2] || 'How to lose weight fast';
    const style = process.argv[3] || 'High Energy';
    const inputDuration = process.argv[4] || 'medium'; // short, medium, long

    // Logic to simulate TimelineService.generateScript duration string
    let durationText = inputDuration;
    if (inputDuration === 'short') durationText = 'Short (2 scenes)';

    const prompt = `Topic: ${topic}\nStyle: ${style}\nTarget Total Duration: ${durationText}`;
    const modelId = process.env.REPLICATE_MODEL_ID || 'openai/gpt-5';

    console.log('--- TEST PARAMETERS ---');
    console.log(`Topic: ${topic}`);
    console.log(`Style: ${style}`);
    console.log(`Duration: ${inputDuration} -> ${durationText}`);
    console.log(`Model: ${modelId}`);
    console.log('--- SENDING PROMPT (Preview) ---');
    console.log(REEL_GENERATOR_SYSTEM_PROMPT.substring(0, 100) + '...');

    try {
        const output = await replicate.run(modelId as any, {
            input: {
                prompt: prompt,
                max_tokens: 2048,
                temperature: 0.7,
                system_prompt: REEL_GENERATOR_SYSTEM_PROMPT
            }
        });

        const content = Array.isArray(output) ? output.join('') : (typeof output === 'object' ? JSON.stringify(output) : String(output));

        // Attempt parse
        const cleanedContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleanedContent);
        } catch {
            const match = cleanedContent.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
        }

        console.log('\n--- OUTPUT (PARSED JSON) ---');
        console.dir(parsed, { depth: null, colors: true });

        if (!parsed) {
            console.log('\n--- RAW OUTPUT ---');
            console.log(content);
        }

    } catch (error) {
        console.error('Error executing Replicate request:', error);
    }
}

main();
