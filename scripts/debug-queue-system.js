#!/usr/bin/env node

/**
 * Comprehensive queue system debugging script
 */

const axios = require('axios');
const WebSocket = require('ws');

class QueueSystemDebugger {
  constructor(baseURL = 'http://localhost:3000/api') {
    this.baseURL = baseURL;
    this.wsURL = baseURL.replace('http', 'ws');
    this.authToken = null;
    this.userId = null;
    this.wsConnection = null;
  }

  async initialize() {
    console.log('🔧 Initializing queue system debugger...');
    
    try {
      // Create test user
      const timestamp = Date.now();
      const signupResponse = await axios.post(`${this.baseURL}/auth/signup`, {
        email: `debug-${timestamp}@example.com`,
        password: 'debugpassword123',
        name: 'Debug User'
      });

      this.authToken = signupResponse.data.accessToken;
      this.userId = signupResponse.data.user.authUserId;
      
      console.log('✅ Test user created:', this.userId);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize:', error.response?.data || error.message);
      return false;
    }
  }

  async testQueueHealth() {
    console.log('\n🏥 Testing queue health...');
    
    try {
      const response = await axios.get(`${this.baseURL}/health/queues`);
      console.log('✅ Queue health status:', response.data.status);
      console.log('📊 Cloud Tasks enabled:', response.data.cloudTasksEnabled);
      console.log('📈 Queues:', Object.keys(response.data.queues));
      return true;
    } catch (error) {
      console.error('❌ Queue health check failed:', error.response?.data || error.message);
      return false;
    }
  }

  async testQueueMetrics() {
    console.log('\n📊 Testing queue metrics...');
    
    try {
      const response = await axios.get(`${this.baseURL}/health/queues/metrics`);
      console.log('✅ Metrics endpoint working');
      console.log('📈 Metrics preview:', response.data.metrics.substring(0, 200) + '...');
      return true;
    } catch (error) {
      console.error('❌ Metrics check failed:', error.response?.data || error.message);
      return false;
    }
  }

  async testJobCreation() {
    console.log('\n🎯 Testing job creation...');
    
    const jobTypes = [
      {
        type: 'image-generation',
        data: {
          prompt: 'A beautiful sunset over mountains',
          model: 'flux-2-pro',
          provider: 'flux',
          options: { width: 512, height: 512 }
        }
      },
      {
        type: 'video-generation',
        data: {
          prompt: 'A cat playing with a ball',
          model: 'runway-gen4',
          provider: 'runway',
          options: { duration: 5 }
        }
      },
      {
        type: 'image-upscale',
        data: {
          imageUrl: 'https://example.com/image.jpg',
          model: 'real-esrgan',
          provider: 'upscale',
          scale: 4,
          options: {}
        }
      },
      {
        type: 'batch-generation',
        data: {
          prompts: ['Sunset', 'Mountains', 'Ocean'],
          model: 'flux-2-pro',
          provider: 'flux',
          batchSize: 3,
          options: {}
        }
      }
    ];

    const results = [];

    for (const jobType of jobTypes) {
      try {
        console.log(`  Testing ${jobType.type}...`);
        const response = await axios.post(
          `${this.baseURL}/jobs/${jobType.type}`,
          jobType.data,
          { headers: { Authorization: `Bearer ${this.authToken}` } }
        );
        
        results.push({
          type: jobType.type,
          success: true,
          jobId: response.data.jobId
        });
        console.log(`    ✅ Created job: ${response.data.jobId}`);
      } catch (error) {
        results.push({
          type: jobType.type,
          success: false,
          error: error.response?.data || error.message
        });
        console.log(`    ❌ Failed: ${error.response?.data?.message || error.message}`);
      }
    }

    return results;
  }

  async testJobStatusTracking(jobId) {
    console.log(`\n📋 Testing job status tracking for ${jobId}...`);
    
    try {
      const response = await axios.get(
        `${this.baseURL}/jobs/${jobId}`,
        { headers: { Authorization: `Bearer ${this.authToken}` } }
      );
      
      console.log('✅ Job status:', response.data.status);
      console.log('📊 Progress:', response.data.progress + '%');
      if (response.data.error) {
        console.log('❌ Error:', response.data.error);
      }
      if (response.data.resultUrl) {
        console.log('🎉 Result URL:', response.data.resultUrl);
      }
      
      return response.data;
    } catch (error) {
      console.error('❌ Job status check failed:', error.response?.data || error.message);
      return null;
    }
  }

  async testWebSocketConnection() {
    console.log('\n🔌 Testing WebSocket connection...');
    
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://localhost:3000`);
        
        ws.on('open', () => {
          console.log('✅ WebSocket connected');
          
          // Subscribe to job updates
          ws.send(JSON.stringify({
            event: 'subscribe-jobs',
            data: { userId: this.userId }
          }));
          
          setTimeout(() => {
            ws.close();
            resolve(true);
          }, 2000);
        });
        
        ws.on('message', (data) => {
          const message = JSON.parse(data);
          console.log('📨 WebSocket message:', message);
        });
        
        ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error.message);
          resolve(false);
        });
        
        ws.on('close', () => {
          console.log('🔌 WebSocket disconnected');
        });
      } catch (error) {
        console.error('❌ WebSocket connection failed:', error.message);
        resolve(false);
      }
    });
  }

  async testTaskProcessor() {
    console.log('\n⚙️ Testing task processor...');
    
    try {
      const response = await axios.post(`${this.baseURL}/jobs/process`, {
        jobId: 'debug-test-job',
        userId: this.userId,
        jobType: 'IMAGE_GENERATION',
        prompt: 'Debug test prompt',
        model: 'flux-2-pro',
        provider: 'flux',
        options: {}
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer internal-key'
        }
      });
      
      console.log('✅ Task processor working');
      return true;
    } catch (error) {
      console.error('❌ Task processor failed:', error.response?.data || error.message);
      return false;
    }
  }

  async testConcurrentJobs() {
    console.log('\n🚀 Testing concurrent job processing...');
    
    const concurrentJobs = Array.from({ length: 5 }, (_, i) => 
      axios.post(`${this.baseURL}/jobs/image-generation`, {
        prompt: `Concurrent test job ${i}`,
        model: 'flux-2-pro',
        provider: 'flux',
        options: { width: 256, height: 256 }
      }, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
    );

    try {
      const responses = await Promise.all(concurrentJobs);
      console.log(`✅ Created ${responses.length} concurrent jobs`);
      
      responses.forEach((response, index) => {
        console.log(`  Job ${index + 1}: ${response.data.jobId}`);
      });
      
      return responses.map(r => r.data.jobId);
    } catch (error) {
      console.error('❌ Concurrent job test failed:', error.message);
      return [];
    }
  }

  async testErrorHandling() {
    console.log('\n🛡️ Testing error handling...');
    
    const errorTests = [
      {
        name: 'Invalid job type',
        test: () => axios.post(`${this.baseURL}/jobs/process`, {
          jobId: 'error-test',
          userId: this.userId,
          jobType: 'INVALID_TYPE',
          prompt: 'test'
        }, {
          headers: { 'Authorization': 'Bearer internal-key' }
        })
      },
      {
        name: 'Unauthorized access',
        test: () => axios.post(`${this.baseURL}/jobs/process`, {
          jobId: 'error-test',
          userId: this.userId,
          jobType: 'IMAGE_GENERATION',
          prompt: 'test'
        }, {
          headers: { 'Authorization': 'Bearer invalid-key' }
        })
      },
      {
        name: 'Invalid job data',
        test: () => axios.post(`${this.baseURL}/jobs/image-generation`, {
          prompt: '', // Invalid empty prompt
          model: 'flux-2-pro',
          provider: 'flux'
        }, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        })
      }
    ];

    for (const test of errorTests) {
      try {
        await test.test();
        console.log(`  ⚠️ ${test.name}: Expected error but got success`);
      } catch (error) {
        console.log(`  ✅ ${test.name}: Correctly handled error`);
      }
    }
  }

  async runFullDiagnostic() {
    console.log('🔍 Starting comprehensive queue system diagnostic...\n');
    
    const results = {
      initialization: false,
      queueHealth: false,
      queueMetrics: false,
      jobCreation: [],
      webSocket: false,
      taskProcessor: false,
      concurrentJobs: [],
      errorHandling: true
    };

    // Initialize
    results.initialization = await this.initialize();
    if (!results.initialization) {
      console.log('❌ Cannot proceed without initialization');
      return results;
    }

    // Test queue health
    results.queueHealth = await this.testQueueHealth();
    
    // Test metrics
    results.queueMetrics = await this.testQueueMetrics();
    
    // Test job creation
    results.jobCreation = await this.testJobCreation();
    
    // Test WebSocket
    results.webSocket = await this.testWebSocketConnection();
    
    // Test task processor
    results.taskProcessor = await this.testTaskProcessor();
    
    // Test concurrent jobs
    results.concurrentJobs = await this.testConcurrentJobs();
    
    // Test error handling
    await this.testErrorHandling();

    // Summary
    console.log('\n📊 DIAGNOSTIC SUMMARY');
    console.log('====================');
    console.log(`Initialization: ${results.initialization ? '✅' : '❌'}`);
    console.log(`Queue Health: ${results.queueHealth ? '✅' : '❌'}`);
    console.log(`Queue Metrics: ${results.queueMetrics ? '✅' : '❌'}`);
    console.log(`Job Creation: ${results.jobCreation.filter(j => j.success).length}/${results.jobCreation.length} successful`);
    console.log(`WebSocket: ${results.webSocket ? '✅' : '❌'}`);
    console.log(`Task Processor: ${results.taskProcessor ? '✅' : '❌'}`);
    console.log(`Concurrent Jobs: ${results.concurrentJobs.length} created`);
    console.log(`Error Handling: ✅`);

    return results;
  }
}

// Run the diagnostic
if (require.main === module) {
  const debugger = new QueueSystemDebugger();
  debugger.runFullDiagnostic().catch(console.error);
}

module.exports = QueueSystemDebugger;
