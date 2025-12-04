import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.image-services and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.image-services') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testElevenLabs() {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
        console.error('❌ ELEVENLABS_API_KEY is not set in environment variables.');
        process.exit(1);
    }

    console.log('🔑 Found ELEVENLABS_API_KEY, testing connection...');

    const client = new ElevenLabsClient({ apiKey });

    try {
        console.log('📡 Fetching voices from ElevenLabs...');
        const response = await client.voices.getAll();

        if (response.voices && response.voices.length > 0) {
            console.log(`✅ Successfully connected! Found ${response.voices.length} voices.`);
            console.log('First 3 voices:');
            response.voices.slice(0, 3).forEach(voice => {
                console.log(`- ${voice.name} (ID: ${voice.voiceId})`);
            });
        } else {
            console.log('✅ Connected, but no voices found (this is unexpected for a standard account).');
        }
    } catch (error) {
        console.error('❌ Failed to connect to ElevenLabs:', error);
    }
}

testElevenLabs();
