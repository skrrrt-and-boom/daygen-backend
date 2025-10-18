#!/usr/bin/env node

/**
 * Test script to verify all image generation models work with the queue system
 */

const fetch = require('node-fetch');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'your-test-token-here';

// All models featured on the website
const TEST_MODELS = [
  { id: 'gemini-2.5-flash-image', provider: 'gemini', name: 'Gemini 2.5 Flash' },
  { id: 'flux-1.1', provider: 'flux', name: 'Flux 1.1' },
  { id: 'reve-image', provider: 'reve', name: 'Reve' },
  { id: 'ideogram', provider: 'ideogram', name: 'Ideogram 3.0' },
  { id: 'recraft', provider: 'recraft', name: 'Recraft' },
  { id: 'qwen-image', provider: 'qwen', name: 'Qwen' },
  { id: 'runway-gen4', provider: 'runway', name: 'Runway Gen-4' },
  { id: 'chatgpt-image', provider: 'openai', name: 'ChatGPT' },
  { id: 'luma-photon-1', provider: 'luma', name: 'Luma Photon 1' },
  { id: 'seedream-3.0', provider: 'seedream', name: 'Seedream 3.0' },
];

async function testModel(model) {
  console.log(`\n🧪 Testing ${model.name} (${model.id})...`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/image-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        prompt: `Test image generation with ${model.name}`,
        model: model.id,
        provider: model.provider,
        options: {
          width: 512,
          height: 512,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ ${model.name}: HTTP ${response.status} - ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    console.log(`✅ ${model.name}: Job created successfully - ${result.jobId}`);
    return { success: true, jobId: result.jobId };
  } catch (error) {
    console.log(`❌ ${model.name}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function checkJobStatus(jobId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();
    return { success: true, status: result.status, progress: result.progress, error: result.error };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting queue system model tests...');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Test Token: ${TEST_TOKEN.substring(0, 10)}...`);
  
  const results = [];
  
  // Test each model
  for (const model of TEST_MODELS) {
    const result = await testModel(model);
    results.push({ model, ...result });
    
    // Wait a bit between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\n✅ Successful Models:');
    successful.forEach(r => {
      console.log(`  - ${r.model.name} (${r.model.id}) - Job: ${r.jobId}`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Models:');
    failed.forEach(r => {
      console.log(`  - ${r.model.name} (${r.model.id}): ${r.error}`);
    });
  }
  
  // Check job statuses for successful jobs
  if (successful.length > 0) {
    console.log('\n🔍 Checking job statuses...');
    for (const result of successful) {
      if (result.jobId) {
        const status = await checkJobStatus(result.jobId);
        if (status.success) {
          console.log(`  - ${result.model.name}: ${status.status} (${status.progress}%)`);
          if (status.error) {
            console.log(`    Error: ${status.error}`);
          }
        } else {
          console.log(`  - ${result.model.name}: Failed to check status - ${status.error}`);
        }
      }
    }
  }
  
  console.log('\n🏁 Test completed!');
  
  // Exit with appropriate code
  process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  });
}

module.exports = { testModel, checkJobStatus };
