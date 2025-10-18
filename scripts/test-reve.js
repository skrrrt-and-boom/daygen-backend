// Test script for Reve API integration
// Run with: node test-reve.js

const REVE_BASE_URL = process.env.REVE_BASE_URL || "https://api.reve.com";
const REVE_API_KEY = process.env.REVE_API_KEY;

async function testReveAPI() {
  if (!REVE_API_KEY) {
    console.error("❌ REVE_API_KEY not found in environment variables");
    console.log("Please set REVE_API_KEY in your .env file or environment");
    return;
  }

  console.log("🧪 Testing Reve API integration...");
  console.log(`📍 Base URL: ${REVE_BASE_URL}`);
  console.log(`🔑 API Key: ${REVE_API_KEY.substring(0, 8)}...`);

  try {
    // Test 1: Submit image generation request
    console.log("\n1️⃣ Testing image generation submission...");
    
    const requestBody = {
      prompt: "A beautiful sunset over mountains"
    };

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

    // Test 2: Check job status
    console.log("\n2️⃣ Testing job status check...");
    
    const statusResponse = await fetch(`${REVE_BASE_URL}/v1/images/${jobId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${REVE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`📊 Status response: ${statusResponse.status}`);
    
    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(`❌ Status API Error: ${statusResponse.status} - ${errorText}`);
      return;
    }

    const statusData = await statusResponse.json();
    console.log("✅ Status check successful!");
    console.log("📋 Status data:", JSON.stringify(statusData, null, 2));

    console.log("\n🎉 Reve API integration test completed successfully!");
    console.log("💡 You can now use the Reve integration in your daygen.ai application");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("🔍 Full error:", error);
  }
}

// Run the test
testReveAPI();
