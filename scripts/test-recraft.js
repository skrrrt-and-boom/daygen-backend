// Test script for Recraft API integration
// Run with: node test-recraft.js

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY || '8YgkweMEMEZoUMmkueo9n4VKrU8DIAro4UYY2X84H0gYzZWUtFTakqQrUyswVa1O';
const BASE_URL = 'https://external.api.recraft.ai/v1';

async function testRecraftAPI() {
  console.log('🧪 Testing Recraft API Integration...\n');

  // Test 1: User info
  console.log('1️⃣ Testing user info endpoint...');
  try {
    const userResponse = await fetch(`${BASE_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (userResponse.ok) {
      const userData = await userResponse.json();
      console.log('✅ User info retrieved:', {
        name: userData.name,
        email: userData.email,
        credits: userData.credits
      });
    } else {
      console.log('❌ User info failed:', userResponse.status, await userResponse.text());
    }
  } catch (error) {
    console.log('❌ User info error:', error.message);
  }

  console.log('\n2️⃣ Testing image generation...');
  try {
    const generateResponse = await fetch(`${BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A beautiful sunset over mountains, digital art style',
        style: 'digital_illustration',
        model: 'recraftv3',
        size: '1024x1024',
        n: 1,
        response_format: 'url'
      })
    });

    if (generateResponse.ok) {
      const generateData = await generateResponse.json();
      console.log('✅ Image generation successful!');
      console.log('📸 Generated image URL:', generateData.data[0]?.url);
    } else {
      console.log('❌ Image generation failed:', generateResponse.status, await generateResponse.text());
    }
  } catch (error) {
    console.log('❌ Image generation error:', error.message);
  }

  console.log('\n3️⃣ Testing with controls and text layout...');
  try {
    const advancedResponse = await fetch(`${BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Modern tech company logo with clean design',
        style: 'vector_illustration',
        model: 'recraftv3',
        size: '1024x1024',
        n: 1,
        controls: {
          artistic_level: 2,
          colors: [{ rgb: [12, 112, 214] }],
          background_color: { rgb: [255, 255, 255] },
          no_text: false
        },
        text_layout: [
          {
            text: 'DAYGEN',
            bbox: [[0.2, 0.3], [0.8, 0.3], [0.8, 0.5], [0.2, 0.5]]
          }
        ],
        response_format: 'url'
      })
    });

    if (advancedResponse.ok) {
      const advancedData = await advancedResponse.json();
      console.log('✅ Advanced generation successful!');
      console.log('📸 Generated image URL:', advancedData.data[0]?.url);
    } else {
      console.log('❌ Advanced generation failed:', advancedResponse.status, await advancedResponse.text());
    }
  } catch (error) {
    console.log('❌ Advanced generation error:', error.message);
  }

  console.log('\n🎉 Recraft API test completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Add VITE_RECRAFT_API_KEY to your .env file');
  console.log('2. Test the integration in your daygen.ai app');
  console.log('3. Use the unified API with model: "recraft-v3" or "recraft-v2"');
}

// Run the test
if (RECRAFT_API_KEY === 'your_api_key_here') {
  console.log('⚠️  Please set RECRAFT_API_KEY environment variable');
  console.log('   Example: RECRAFT_API_KEY=your_key node test-recraft.js');
} else {
  testRecraftAPI();
}
