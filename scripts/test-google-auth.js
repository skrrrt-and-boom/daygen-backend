#!/usr/bin/env node

/**
 * Test script for Google OAuth authentication
 * This script tests the Google OAuth endpoints to ensure they're working correctly
 */

const axios = require('axios');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';

async function testGoogleAuth() {
  console.log('🧪 Testing Google OAuth endpoints...\n');

  try {
    // Test 1: Generate Google OAuth URL
    console.log('1. Testing Google OAuth URL generation...');
    const authResponse = await axios.post(`${BASE_URL}/api/auth/google`);
    
    if (authResponse.data.authUrl) {
      console.log('✅ Google OAuth URL generated successfully');
      console.log(`   URL: ${authResponse.data.authUrl}`);
    } else {
      console.log('❌ Failed to generate Google OAuth URL');
      return;
    }

    // Test 2: Check if the URL contains required parameters
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

    // Test 3: Test callback endpoint (should return error without code)
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
    console.log('\n📝 Next steps:');
    console.log('   1. Make sure you have set up Google OAuth credentials in Google Console');
    console.log('   2. Configure the redirect URI in Google Console:');
    console.log(`      ${BASE_URL}/api/auth/google/callback`);
    console.log('   3. Test the full OAuth flow in your frontend application');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }

    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Make sure the backend server is running');
    console.log('   2. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set');
    console.log('   3. Verify the backend URL is correct');
  }
}

// Run the test
testGoogleAuth();
