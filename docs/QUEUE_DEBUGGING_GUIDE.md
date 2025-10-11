# Queue System Debugging & Development Guide

This guide covers the enhanced debugging and development capabilities added to the queue system.

## 🚀 **New Features Implemented**

### **1. Structured Logging with Pino**
- **Location**: `src/common/logger.service.ts`
- **Features**:
  - JSON-formatted logs with timestamps
  - Request correlation IDs
  - Performance logging
  - Error context tracking
  - Development vs production formatting

**Usage**:
```typescript
// In any service
constructor(private readonly structuredLogger: LoggerService) {}

// Log job events
this.structuredLogger.logJobEvent('job_started', {
  jobId, userId, jobType, requestId
});

// Log errors with context
this.structuredLogger.logError(error, {
  jobId, userId, context: 'job_processing'
});

// Log performance metrics
this.structuredLogger.logPerformance('image_generation', 2.5, {
  model: 'flux-1.1', provider: 'flux'
});
```

### **2. Request Correlation System**
- **Location**: `src/common/request-context.service.ts`
- **Features**:
  - Unique request IDs for each job
  - Context storage throughout request lifecycle
  - Duration tracking
  - Automatic cleanup

**Usage**:
```typescript
// Automatically injected in request scope
const requestId = this.requestContext.getRequestId();
this.requestContext.setContext('jobId', jobId);
const allContext = this.requestContext.getAllContext();
```

### **3. Prometheus Metrics Collection**
- **Location**: `src/common/metrics.service.ts`
- **Features**:
  - Job processing counters
  - Duration histograms
  - Queue depth monitoring
  - Error rate tracking
  - Credit usage tracking

**Available Metrics**:
- `jobs_total` - Total jobs processed by type/status/provider
- `job_duration_seconds` - Job processing duration
- `queue_depth` - Number of jobs in each queue
- `active_jobs` - Currently processing jobs
- `job_errors_total` - Error counts by type
- `credits_used_total` - Credit usage tracking

### **4. Queue Health Monitoring**
- **Location**: `src/health/queue-health.controller.ts`
- **Endpoints**:
  - `GET /api/health/queues` - Overall queue health
  - `GET /api/health/queues/metrics` - Prometheus metrics
  - `GET /api/health/queues/job/:jobId/debug` - Job debugging info

**Health Check Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "cloudTasksEnabled": true,
  "queues": {
    "image-generation-queue": {
      "depth": 0,
      "processingRate": 0,
      "errorRate": 0
    }
  },
  "processingStats": {
    "totalJobsProcessed": 0,
    "activeJobs": 0,
    "averageProcessingTime": 0,
    "errorRate": 0
  }
}
```

### **5. Enhanced WebSocket Reliability**
- **Location**: `src/jobs/jobs.gateway.ts`
- **Improvements**:
  - Error handling for failed broadcasts
  - Fallback mechanisms
  - Connection monitoring
  - Structured logging for WebSocket events

### **6. Comprehensive Testing Suite**
- **Location**: `test/queue-system.e2e-spec.ts`
- **Coverage**:
  - Job creation and processing
  - Queue health monitoring
  - WebSocket integration
  - Metrics collection
  - Error handling
  - Concurrent job processing

## 🛠️ **Debugging Tools**

### **1. Queue System Debugger Script**
```bash
# Run comprehensive diagnostic
npm run debug:queue

# Or directly
node scripts/debug-queue-system.js
```

**What it tests**:
- Queue health and metrics
- All job types (image, video, upscale, batch)
- WebSocket connections
- Task processor functionality
- Concurrent job handling
- Error scenarios

### **2. Integration Tests**
```bash
# Run queue-specific tests
npm run test:queue

# Run all e2e tests
npm run test:e2e
```

### **3. Health Monitoring**
```bash
# Check queue health
curl http://localhost:3000/api/health/queues

# Get metrics
curl http://localhost:3000/api/health/queues/metrics

# Debug specific job
curl http://localhost:3000/api/health/queues/job/{jobId}/debug
```

## 📊 **Monitoring & Observability**

### **1. Log Analysis**
All logs are now structured JSON with consistent fields:
```json
{
  "level": "info",
  "time": "2024-01-15T10:30:00.000Z",
  "event": "job_started",
  "jobId": "job_123",
  "userId": "user_456",
  "jobType": "IMAGE_GENERATION",
  "requestId": "req_789",
  "processingMode": "inline"
}
```

### **2. Metrics Dashboard**
Access Prometheus metrics at `/api/health/queues/metrics` for:
- Job processing rates
- Error rates
- Queue depths
- Processing times
- Credit usage

### **3. Real-time Monitoring**
- WebSocket connections for live updates
- Queue health endpoints for system status
- Structured logs for debugging

## 🔧 **Development Workflow**

### **1. Local Development**
```bash
# Start with enhanced logging
npm run start:dev

# Run debugger
npm run debug:queue

# Check health
curl http://localhost:3000/api/health/queues
```

### **2. Testing**
```bash
# Run specific queue tests
npm run test:queue

# Run all tests
npm run test

# Run with coverage
npm run test:cov
```

### **3. Production Monitoring**
- Monitor `/api/health/queues` endpoint
- Set up alerts on error rates
- Track queue depths and processing times
- Monitor credit usage patterns

## 🐛 **Common Issues & Solutions**

### **1. Job Processing Failures**
**Check**:
- Job status via `/api/jobs/{jobId}`
- Error logs with request ID
- Queue health status
- Credit availability

**Debug**:
```bash
# Get job debug info
curl http://localhost:3000/api/health/queues/job/{jobId}/debug

# Check logs for request ID
grep "req_123" backend.log
```

### **2. WebSocket Issues**
**Check**:
- Connection status in browser dev tools
- WebSocket error logs
- Fallback mechanisms

**Debug**:
- Check WebSocket connection in debugger script
- Review structured logs for WebSocket events

### **3. Queue Performance Issues**
**Check**:
- Queue depths via health endpoint
- Processing rates in metrics
- Error rates and types

**Debug**:
- Run concurrent job tests
- Monitor metrics over time
- Check for resource constraints

## 📈 **Performance Optimization**

### **1. Metrics to Monitor**
- `job_duration_seconds` - Processing time
- `queue_depth` - Backlog size
- `active_jobs` - Concurrent processing
- `job_errors_total` - Error rates

### **2. Optimization Strategies**
- Scale based on queue depth
- Optimize based on duration metrics
- Address high error rates
- Monitor credit usage patterns

### **3. Alerting Thresholds**
- Queue depth > 100 jobs
- Error rate > 5%
- Average processing time > 30 seconds
- Credit usage spikes

## 🔮 **Future Enhancements**

### **1. Advanced Monitoring**
- Grafana dashboards
- Alert manager integration
- Custom metrics
- Performance profiling

### **2. Enhanced Debugging**
- Job replay functionality
- Step-by-step debugging
- Performance profiling
- Memory usage tracking

### **3. Operational Tools**
- Job cancellation
- Queue management
- Bulk operations
- Admin dashboard

## 📚 **API Reference**

### **Health Endpoints**
- `GET /api/health/queues` - Queue health status
- `GET /api/health/queues/metrics` - Prometheus metrics
- `GET /api/health/queues/job/:jobId/debug` - Job debug info

### **Job Endpoints**
- `POST /api/jobs/image-generation` - Create image job
- `POST /api/jobs/video-generation` - Create video job
- `POST /api/jobs/image-upscale` - Create upscale job
- `POST /api/jobs/batch-generation` - Create batch job
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs` - List user jobs

### **Internal Endpoints**
- `POST /api/jobs/process` - Process job (internal)

This enhanced queue system now provides comprehensive debugging, monitoring, and development capabilities to help maintain and scale the platform effectively.
