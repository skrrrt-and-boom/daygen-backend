// Test script for Reve API integration with corrected parameters
// Run with: node test-reve-fixed.js

const REVE_BASE_URL = process.env.REVE_BASE_URL || "https://api.reve.com";
const REVE_API_KEY = process.env.REVE_API_KEY;

async function testReveAPIFixed() {
  if (!REVE_API_KEY) {
    console.error("❌ REVE_API_KEY not found in environment variables");
    console.log("Please set REVE_API_KEY in your .env file or environment");
    return;
  }

  console.log("🧪 Testing Reve API integration with corrected parameters...");
  console.log(`📍 Base URL: ${REVE_BASE_URL}`);
  console.log(`🔑 API Key: ${REVE_API_KEY.substring(0, 8)}...`);

  try {
    // Test with minimal supported parameters only
    console.log("\n1️⃣ Testing image generation with minimal parameters...");
    
    const requestBody = {
      prompt: "A beautiful sunset over mountains"
      // Only using prompt - no unsupported parameters
    };

    console.log("📤 Request payload:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${REVE_BASE_URL}/v1/image/create`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REVE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📊 Response status: ${response.status}`);
    
    const responseText = await response.text();
    console.log(`📄 Response body: ${responseText.substring(0, 500)}...`);
    
    if (!response.ok) {
      console.error(`❌ API Error: ${response.status} - ${responseText}`);
      return;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`❌ JSON Parse Error: ${e.message}`);
      console.log(`📄 Full response: ${responseText}`);
      return;
    }
    console.log("✅ Generation request submitted successfully!");
    console.log("📋 Response data:", JSON.stringify(data, null, 2));

    const jobId = data.id || data.job_id || data.request_id;
    if (!jobId) {
      console.error("❌ No job ID found in response");
      return;
    }

    console.log(`🆔 Job ID: ${jobId}`);

    // Test 2: Test with additional supported parameters
    console.log("\n2️⃣ Testing with additional supported parameters...");
    
    const extendedRequestBody = {
      prompt: "A futuristic cityscape at night",
      width: 1024,
      height: 1024,
      seed: 42,
      guidance_scale: 7.5,
      steps: 20,
      negative_prompt: "blurry, low quality"
    };

    console.log("📤 Extended request payload:", JSON.stringify(extendedRequestBody, null, 2));

    const extendedResponse = await fetch(`${REVE_BASE_URL}/v1/image/create`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REVE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(extendedRequestBody),
    });

    console.log(`📊 Extended response status: ${extendedResponse.status}`);
    
    if (!extendedResponse.ok) {
      const errorText = await extendedResponse.text();
      console.error(`❌ Extended API Error: ${extendedResponse.status} - ${errorText}`);
    } else {
      console.log("✅ Extended request with supported parameters successful!");
    }

    console.log("\n🎉 Reve API integration test completed!");
    console.log("💡 The API should now work correctly with the corrected parameters");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("🔍 Full error:", error);
  }
}

// Run the test
testReveAPIFixed();
