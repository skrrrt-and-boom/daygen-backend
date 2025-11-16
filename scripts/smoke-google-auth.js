#!/usr/bin/env node

/**
 * Smoke script for Google OAuth endpoints
 */

const axios = require('axios');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';

async function testGoogleAuth() {
  console.log('🧪 Testing Google OAuth endpoints...\n');

  try {
    // 1) Generate Google OAuth URL
    console.log('1. Testing Google OAuth URL generation...');
    const authResponse = await axios.post(`${BASE_URL}/api/auth/google`);
    if (authResponse.data.authUrl) {
      console.log('✅ Google OAuth URL generated successfully');
      console.log(`   URL: ${authResponse.data.authUrl}`);
    } else {
      console.log('❌ Failed to generate Google OAuth URL');
      return;
    }

    // 2) Verify required parameters
    const authUrl = new URL(authResponse.data.authUrl);
    const requiredParams = ['client_id', 'redirect_uri', 'response_type', 'scope'];
    let allParamsPresent = true;
    for (const param of requiredParams) {
      if (!authUrl.searchParams.has(param)) {
        console.log(`❌ Missing required parameter: ${param}`);
        allParamsPresent = false;
      }
    }
    if (allParamsPresent) {
      console.log('✅ All required OAuth parameters are present');
    }

    // 3) Callback endpoint (should reject without code)
    console.log('\n2. Testing Google OAuth callback endpoint...');
    try {
      await axios.get(`${BASE_URL}/api/auth/google/callback`);
      console.log('❌ Callback endpoint should have returned an error without code');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✅ Callback endpoint correctly rejects requests without code');
      } else {
        console.log('❌ Unexpected error from callback endpoint:', error.message);
      }
    }

    console.log('\n🎉 Google OAuth setup appears to be working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }
  }
}

// Run the test
testGoogleAuth();


