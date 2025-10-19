# Queue System Implementation

This document describes the complete queue system implementation using Google Cloud Tasks.

## Overview

The queue system has been migrated from BullMQ/Redis to Google Cloud Tasks for better scalability and reliability. The system supports multiple job types with separate queues for optimal performance.

## Architecture

### Job Types

1. **IMAGE_GENERATION** - Single image generation
2. **VIDEO_GENERATION** - Video generation from prompts or images
3. **IMAGE_UPSCALE** - Image upscaling/enhancement
4. **BATCH_GENERATION** - Multiple image generation in batches

### Queue Structure

Each job type has its own dedicated Cloud Tasks queue:

- `image-generation-queue` - For single image generation jobs
- `video-generation-queue` - For video generation jobs
- `image-upscale-queue` - For image upscaling jobs
- `batch-generation-queue` - For batch generation jobs

### Components

1. **CloudTasksService** - Handles job creation and management
2. **TaskProcessorController** - Processes jobs from Cloud Tasks
3. **JobsController** - API endpoints for job management
4. **JobsGateway** - WebSocket updates for real-time progress

## Setup

### 1. Prerequisites

- Google Cloud CLI installed and authenticated
- Project with Cloud Tasks API enabled
- Service account with appropriate permissions

### 2. Local Development Setup

Run the setup script to configure authentication:

```bash
./scripts/setup-local-auth.sh
```

This will:
- Create a service account for local development
- Generate a service account key
- Set up environment variables
- Grant necessary permissions

### 3. Create Cloud Tasks Queues

Run the queue setup script:

```bash
./scripts/setup-cloud-tasks-queues.sh
```

This creates all necessary queues with appropriate configuration.

### 4. Environment Variables

Required environment variables:

```bash
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=europe-central2
# Note: GOOGLE_APPLICATION_CREDENTIALS only needed for local development
# Cloud Run uses Application Default Credentials automatically

# API Configuration
API_BASE_URL=http://localhost:3000  # or your production URL
INTERNAL_API_KEY=your-internal-key
```

## API Endpoints

### Create Jobs

#### Image Generation
```http
POST /api/jobs/image-generation
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "prompt": "A beautiful sunset",
  "model": "flux-1.1-pro",
  "provider": "bfl",
  "options": {
    "width": 1024,
    "height": 1024
  }
}
```

#### Video Generation
```http
POST /api/jobs/video-generation
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "prompt": "A cat playing with a ball",
  "model": "runway-gen4",
  "provider": "runway",
  "imageUrls": ["https://example.com/image.jpg"],
  "options": {
    "duration": 5
  }
}
```

#### Image Upscale
```http
POST /api/jobs/image-upscale
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "imageUrl": "https://example.com/image.jpg",
  "model": "real-esrgan",
  "provider": "upscale",
  "scale": 4,
  "options": {}
}
```

#### Batch Generation
```http
POST /api/jobs/batch-generation
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "prompts": [
    "A beautiful sunset",
    "A cat playing",
    "A mountain landscape"
  ],
  "model": "flux-1.1-pro",
  "provider": "bfl",
  "batchSize": 5,
  "options": {}
}
```

### Get Job Status

```http
GET /api/jobs/{jobId}
Authorization: Bearer <jwt-token>
```

### Get User Jobs

```http
GET /api/jobs?limit=20&cursor=jobId
Authorization: Bearer <jwt-token>
```

## Job Processing

### Task Processor

The `TaskProcessorController` handles job processing:

1. **Authentication** - Verifies internal API key
2. **Job Routing** - Routes to appropriate handler based on job type
3. **Progress Updates** - Updates job progress throughout processing
4. **Error Handling** - Handles failures and updates job status
5. **Usage Tracking** - Records usage for billing

### Processing Flow

1. Job created via API endpoint
2. Job record saved to database
3. Cloud Task created and queued
4. Task processor receives and processes job
5. Progress updates sent via WebSocket
6. Job completed and result saved

## WebSocket Updates

Real-time progress updates are sent via WebSocket:

```typescript
// Client-side WebSocket connection
const socket = io('ws://localhost:3000');

socket.on('jobUpdate', (data) => {
  console.log('Job update:', data);
  // {
  //   jobId: 'job-123',
  //   status: 'PROCESSING',
  //   progress: 50,
  //   resultUrl: 'https://...'
  // }
});
```

## Error Handling

### Job Failures

- Jobs are retried up to 3 times
- Failed jobs are marked with error details
- Error messages are sent via WebSocket

### Credit Management

- Credits are checked before processing
- Different job types have different costs:
  - Image Generation: 1 credit
  - Video Generation: 5 credits
  - Image Upscale: 2 credits
  - Batch Generation: 1 credit per image

## Monitoring

### Cloud Tasks Console

Monitor queue performance in the Google Cloud Console:
- Queue depth and processing rates
- Failed task details
- Retry attempts and success rates

### Application Logs

All job processing is logged with:
- Job ID and user ID
- Processing steps and progress
- Errors and stack traces
- Performance metrics

## Scaling

### Queue Configuration

Each queue is configured with:
- Max dispatches per second: 10
- Max concurrent dispatches: 100
- Max retry attempts: 3
- Max retry duration: 1 hour

### Auto-scaling

Cloud Tasks automatically scales based on:
- Queue depth
- Processing capacity
- Error rates

## Migration from BullMQ

The migration from BullMQ/Redis to Cloud Tasks provides:

1. **Better Reliability** - Google's managed service
2. **Automatic Scaling** - No Redis cluster management
3. **Cost Efficiency** - Pay per use model
4. **Better Monitoring** - Built-in observability
5. **Simplified Architecture** - Fewer moving parts

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Check Cloud Run service account permissions
   - Verify required IAM roles are assigned
   - For local development: check service account key file

2. **Queue Not Found**
   - Run setup script to create queues
   - Check project ID and location

3. **Job Processing Failures**
   - Check internal API key
   - Verify API_BASE_URL
   - Review application logs

### Debug Commands

```bash
# Check authentication
gcloud auth list

# List queues
gcloud tasks queues list --location=europe-central2

# View queue details
gcloud tasks queues describe image-generation-queue --location=europe-central2

# Check service account permissions
gcloud projects get-iam-policy daygen-backend-365299591811
```

## Future Enhancements

1. **Priority Queues** - Different priority levels for jobs
2. **Scheduled Jobs** - Delayed execution
3. **Job Dependencies** - Chain jobs together
4. **Custom Retry Logic** - Job-specific retry strategies
5. **Metrics Integration** - Prometheus/Grafana monitoring
