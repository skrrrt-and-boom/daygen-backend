# Production Deployment Guide

## 🚀 Complete Production Setup

This guide covers deploying the DayGen backend to Google Cloud Run with full queue system support.

## Prerequisites

- Google Cloud CLI installed and authenticated
- Docker installed
- Node.js 20+ installed
- All API keys for image generation services

## Environment Variables

### Required Environment Variables

```bash
# Database Configuration
DATABASE_URL="postgresql://username:password@host:port/database?pgbouncer=true"
DIRECT_URL="postgresql://username:password@host:port/database"

# JWT Secret (generate a strong secret for production)
JWT_SECRET="your-super-secure-jwt-secret-here"

# Cloudflare R2 Configuration
CLOUDFLARE_R2_ACCOUNT_ID="your-account-id"
CLOUDFLARE_R2_ACCESS_KEY_ID="your-access-key-id"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-secret-access-key"
CLOUDFLARE_R2_BUCKET_NAME="your-bucket-name"
CLOUDFLARE_R2_PUBLIC_URL="https://your-public-url.r2.dev"

# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT="your-project-id"
GOOGLE_CLOUD_LOCATION="europe-central2"
GOOGLE_APPLICATION_CREDENTIALS="/app/service-account-key.json"
API_BASE_URL="https://your-service-url.run.app"
INTERNAL_API_KEY="your-internal-api-key"

# Image Generation API Keys
OPENAI_API_KEY="sk-proj-your-openai-key"
GEMINI_API_KEY="your-gemini-key"
BFL_API_KEY="your-bfl-key"
BFL_API_BASE="https://api.bfl.ai"
IDEOGRAM_API_KEY="your-ideogram-key"
DASHSCOPE_API_KEY="your-dashscope-key"
RUNWAY_API_KEY="your-runway-key"
ARK_API_KEY="your-ark-key"
REVE_API_KEY="your-reve-key"
RECRAFT_API_KEY="your-recraft-key"
LUMAAI_API_KEY="your-luma-key"

# Server Configuration
PORT=3000
NODE_ENV=production
```

## Deployment Steps

### 1. Setup Google Cloud Authentication

```bash
# Authenticate with Google Cloud
gcloud auth login

# Set your project
gcloud config set project your-project-id

# Enable required APIs
gcloud services enable cloudtasks.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable iam.googleapis.com
```

### 2. Create Cloud Tasks Queues

```bash
# Run the queue setup script
./scripts/setup-cloud-tasks-queues.sh
```

### 3. Deploy to Google Cloud Run

```bash
# Deploy using the deployment script
./scripts/deploy-with-env.sh
```

### 4. Set Production Environment Variables

```bash
# Set the production API base URL
gcloud run services update daygen-backend \
  --region=europe-central2 \
  --set-env-vars="API_BASE_URL=https://your-service-url.run.app"
```

## API Endpoints

### Health Check
```bash
GET https://your-service-url.run.app/health
```

### Image Generation
```bash
POST https://your-service-url.run.app/api/jobs/image-generation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "prompt": "A beautiful sunset",
  "model": "flux-pro",
  "provider": "bfl",
  "options": {
    "width": 1024,
    "height": 1024
  }
}
```

### Video Generation
```bash
POST https://your-service-url.run.app/api/jobs/video-generation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "prompt": "A cat playing with a ball",
  "model": "runway-gen4",
  "provider": "runway",
  "options": {
    "duration": 5
  }
}
```

### Image Upscale
```bash
POST https://your-service-url.run.app/api/jobs/image-upscale
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "imageUrl": "https://example.com/image.jpg",
  "model": "real-esrgan",
  "provider": "upscale",
  "scale": 4
}
```

### Batch Generation
```bash
POST https://your-service-url.run.app/api/jobs/batch-generation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "prompts": [
    "A beautiful sunset",
    "A cat playing",
    "A mountain landscape"
  ],
  "model": "flux-pro",
  "provider": "bfl",
  "batchSize": 5
}
```

## Monitoring

### Google Cloud Console
- **Cloud Tasks**: Monitor queue performance and job processing
- **Cloud Run**: Monitor application health and scaling
- **Logging**: View application logs and errors

### Key Metrics
- Queue depth (number of pending jobs)
- Processing rate (jobs completed per minute)
- Error rate (failed jobs percentage)
- Response times

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Check service account permissions
   - Verify GOOGLE_APPLICATION_CREDENTIALS

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

# Check service logs
gcloud logs read --service=daygen-backend --limit=50
```

## Scaling

The system automatically scales based on:
- Queue depth
- Processing capacity
- Error rates

### Manual Scaling
```bash
# Scale Cloud Run service
gcloud run services update daygen-backend \
  --region=europe-central2 \
  --min-instances=1 \
  --max-instances=10
```

## Security

- All API keys are stored as environment variables
- JWT tokens are used for authentication
- Internal API key protects job processing endpoints
- Service account has minimal required permissions

## Cost Optimization

- Cloud Tasks charges per operation
- Cloud Run charges per request and compute time
- R2 storage charges per GB stored
- Monitor usage in Google Cloud Console

## Support

For issues or questions:
1. Check the logs in Google Cloud Console
2. Review the troubleshooting section
3. Check the queue system documentation
