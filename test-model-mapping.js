#!/usr/bin/env node

/**
 * Test script to verify model mapping works correctly
 */

// Simulate the model mapping function from task-processor.controller.ts
function mapQueueModelToGenerationModel(model, provider) {
  const modelMappings = {
    // Gemini models
    'gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
    
    // Flux models
    'flux-1.1': 'flux-pro-1.1',
    'flux-pro-1.1': 'flux-pro-1.1',
    'flux-pro-1.1-ultra': 'flux-pro-1.1-ultra',
    'flux-kontext-pro': 'flux-kontext-pro',
    'flux-kontext-max': 'flux-kontext-max',
    'flux-pro': 'flux-pro',
    'flux-dev': 'flux-dev',
    
    // Reve models
    'reve-image': 'reve-image',
    'reve-image-1.0': 'reve-image-1.0',
    'reve-v1': 'reve-v1',
    
    // Recraft models
    'recraft': 'recraft-v3',
    'recraft-v2': 'recraft-v2',
    'recraft-v3': 'recraft-v3',
    
    // Luma models
    'luma-photon-1': 'luma-photon-1',
    'luma-photon-flash-1': 'luma-photon-flash-1',
    'luma-dream-shaper': 'luma-dream-shaper',
    'luma-realistic-vision': 'luma-realistic-vision',
    
    // Other models
    'ideogram': 'ideogram',
    'qwen-image': 'qwen-image',
    'runway-gen4': 'runway-gen4',
    'runway-gen4-turbo': 'runway-gen4-turbo',
    'chatgpt-image': 'chatgpt-image',
    'seedream-3.0': 'seedream-3.0',
  };

  return modelMappings[model] || model;
}

// Test cases
const testCases = [
  { input: 'gemini-2.5-flash-image', expected: 'gemini-2.5-flash-image-preview', description: 'Gemini model mapping' },
  { input: 'flux-1.1', expected: 'flux-pro-1.1', description: 'Flux model mapping' },
  { input: 'reve-image', expected: 'reve-image', description: 'Reve model mapping' },
  { input: 'recraft', expected: 'recraft-v3', description: 'Recraft model mapping' },
  { input: 'luma-photon-1', expected: 'luma-photon-1', description: 'Luma model mapping' },
  { input: 'ideogram', expected: 'ideogram', description: 'Ideogram model mapping' },
  { input: 'unknown-model', expected: 'unknown-model', description: 'Unknown model fallback' },
];

function runTests() {
  console.log('🧪 Testing model mapping function...\n');
  
  let passed = 0;
  let failed = 0;
  
  testCases.forEach((testCase, index) => {
    const result = mapQueueModelToGenerationModel(testCase.input, 'test-provider');
    const success = result === testCase.expected;
    
    console.log(`Test ${index + 1}: ${testCase.description}`);
    console.log(`  Input: ${testCase.input}`);
    console.log(`  Expected: ${testCase.expected}`);
    console.log(`  Got: ${result}`);
    console.log(`  Result: ${success ? '✅ PASS' : '❌ FAIL'}\n`);
    
    if (success) {
      passed++;
    } else {
      failed++;
    }
  });
  
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { mapQueueModelToGenerationModel };
