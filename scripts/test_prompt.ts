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

    // Parse extra args as reference images
    const extraArgs = process.argv.slice(5);
    const referenceImageUrls = extraArgs.length > 0 ? extraArgs : [];

    // Logic to simulate TimelineService.generateScript duration string
    // Must match TimelineService exactly to test properly
    let sceneCount = 6;
    let durationText = '';

    switch (inputDuration) {
        case 'short':
            sceneCount = 3;
            durationText = 'Short (Exactly 3 scenes)';
            break;
        case 'medium':
            sceneCount = 6;
            durationText = 'Medium (Exactly 6 scenes)';
            break;
        case 'long':
            sceneCount = 12;
            durationText = 'Long (Exactly 12 scenes)';
            break;
        default:
            // Fallback if user types something random, though Service defaults to medium
            sceneCount = 6;
            durationText = 'Medium (Exactly 6 scenes)';
    }

    const referenceCount = referenceImageUrls.length;
    const refInstruction = referenceCount > 0
        ? `You have ${referenceCount} user-provided images (indices 0 to ${referenceCount - 1}).\n` +
        `For each scene, strictly add a 'visual_source' field with one of these values:\n` +
        ` - 'generated': Create a new image based on visual_prompt.\n` +
        ` - 'last_frame': Use the image from the immediately preceding scene (for continuity).\n` +
        ` - 'user_image_{index}': Use user reference image at index {index} (e.g., 'user_image_0'). Set this ONLY if the scene clearly refers to the subject in that provided image.`
        : `For each scene, add a 'visual_source' field: set to 'last_frame' if the scene continues the previous shot, otherwise 'generated'.`;

    const prompt = `Topic: ${topic}\nStyle: ${style}\nTarget: ${durationText}\n${refInstruction}\nInstruction: Strictly generate EXACTLY ${sceneCount} scenes. Output JSON only. No more, no less.`;

    const modelId = process.env.REPLICATE_MODEL_ID || 'openai/gpt-5';

    console.log('--- TEST PARAMETERS ---');
    console.log(`Topic: ${topic}`);
    console.log(`Style: ${style}`);
    console.log(`Duration: ${inputDuration} -> ${durationText}`);
    console.log(`Scene Count Target: ${sceneCount}`);
    console.log(`Reference Images: ${referenceCount}`);
    if (referenceCount > 0) {
        referenceImageUrls.forEach((url, i) => console.log(`  [${i}] ${url}`));
    }
    console.log(`Model: ${modelId}`);
    console.log('--- SENDING PROMPT (Preview) ---');
    console.log(prompt);

    try {
        const output = await replicate.run(modelId as any, {
            input: {
                prompt: prompt,
                image_input: referenceCount > 0 ? referenceImageUrls : undefined,
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
