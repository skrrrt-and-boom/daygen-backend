// Test script to verify basic authentication is working
// Run this with: node test-auth.js

const https = require('https');

// Test credentials (replace with your actual credentials)
const username = 'your_username';
const password = 'your_password';

// Test URL (replace with your Vercel URL)
const testUrl = 'https://your-app.vercel.app';

// Create basic auth header
const credentials = Buffer.from(`${username}:${password}`).toString('base64');
const authHeader = `Basic ${credentials}`;

// Test the authentication
const options = {
  hostname: new URL(testUrl).hostname,
  port: 443,
  path: '/',
  method: 'GET',
  headers: {
    'Authorization': authHeader,
    'User-Agent': 'Test-Script'
  }
};

console.log('Testing basic authentication...');
console.log(`URL: ${testUrl}`);
console.log(`Username: ${username}`);
console.log(`Auth Header: ${authHeader}`);

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Authentication successful!');
      console.log('Response length:', data.length);
    } else if (res.statusCode === 401) {
      console.log('❌ Authentication failed - Invalid credentials');
    } else {
      console.log(`⚠️  Unexpected status code: ${res.statusCode}`);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.end();
