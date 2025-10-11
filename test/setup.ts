import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file from the project root
config({ path: resolve(__dirname, '../.env') });

// Set default test values for required environment variables
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/daygen_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

// Set test API keys if not already set
process.env.BFL_API_KEY = process.env.BFL_API_KEY || 'test-bfl-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
process.env.IDEOGRAM_API_KEY = process.env.IDEOGRAM_API_KEY || 'test-ideogram-key';
process.env.REVE_API_KEY = process.env.REVE_API_KEY || 'test-reve-key';
process.env.RECRAFT_API_KEY = process.env.RECRAFT_API_KEY || 'test-recraft-key';
process.env.RUNWAY_API_KEY = process.env.RUNWAY_API_KEY || 'test-runway-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-dashscope-key';
process.env.ARK_API_KEY = process.env.ARK_API_KEY || 'test-ark-key';

// Disable Cloud Tasks for tests
process.env.USE_CLOUD_TASKS = 'false';

console.log('Test environment setup complete');
