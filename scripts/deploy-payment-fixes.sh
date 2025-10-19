#!/bin/bash

# Deploy Payment Integration Fixes to Google Cloud Run
# This script builds and deploys the backend with all required environment variables

set -e

echo "🚀 Deploying Payment Integration Fixes to Google Cloud Run..."

# Configuration
PROJECT_ID="daygen-backend-365299591811"
SERVICE_NAME="daygen-backend"
REGION="europe-central2"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo "❌ Google Cloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated with Google Cloud. Please run 'gcloud auth login' first."
    exit 1
fi

# Set the project
echo "📋 Setting project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# Build the Docker image
echo "🔨 Building Docker image..."
docker build -t ${IMAGE_NAME} .

# Push the image to Google Container Registry
echo "📤 Pushing image to Google Container Registry..."
docker push ${IMAGE_NAME}

# Deploy to Cloud Run with all required environment variables
echo "🚀 Deploying to Cloud Run..."

# Note: You'll need to set these environment variables in your Google Cloud Console
# or replace the placeholder values with actual values
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 900 \
  --concurrency 1000 \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="PORT=3000" \
  --set-env-vars="API_BASE_URL=https://${SERVICE_NAME}-${PROJECT_ID}.${REGION}.run.app" \
  --update-env-vars="DATABASE_URL=${DATABASE_URL}" \
  --update-env-vars="DIRECT_URL=${DIRECT_URL}" \
  --update-env-vars="JWT_SECRET=${JWT_SECRET}" \
  --update-env-vars="SUPABASE_URL=${SUPABASE_URL}" \
  --update-env-vars="SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}" \
  --update-env-vars="SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}" \
  --update-env-vars="STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}" \
  --update-env-vars="STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY}" \
  --update-env-vars="STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}" \
  --update-env-vars="FRONTEND_URL=https://daygen.ai" \
  --update-env-vars="STRIPE_TEST_PRICE_ID=${STRIPE_TEST_PRICE_ID}" \
  --update-env-vars="STRIPE_STARTER_PRICE_ID=${STRIPE_STARTER_PRICE_ID}" \
  --update-env-vars="STRIPE_POPULAR_PRICE_ID=${STRIPE_POPULAR_PRICE_ID}" \
  --update-env-vars="STRIPE_BEST_VALUE_PRICE_ID=${STRIPE_BEST_VALUE_PRICE_ID}" \
  --update-env-vars="STRIPE_PRO_PRICE_ID=${STRIPE_PRO_PRICE_ID}" \
  --update-env-vars="STRIPE_ENTERPRISE_PRICE_ID=${STRIPE_ENTERPRISE_PRICE_ID}" \
  --update-env-vars="CLOUDFLARE_R2_ACCOUNT_ID=${CLOUDFLARE_R2_ACCOUNT_ID}" \
  --update-env-vars="CLOUDFLARE_R2_ACCESS_KEY_ID=${CLOUDFLARE_R2_ACCESS_KEY_ID}" \
  --update-env-vars="CLOUDFLARE_R2_SECRET_ACCESS_KEY=${CLOUDFLARE_R2_SECRET_ACCESS_KEY}" \
  --update-env-vars="CLOUDFLARE_R2_BUCKET_NAME=${CLOUDFLARE_R2_BUCKET_NAME}" \
  --update-env-vars="CLOUDFLARE_R2_PUBLIC_URL=${CLOUDFLARE_R2_PUBLIC_URL}"

echo "✅ Deployment completed!"

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")
echo "🌐 Service URL: ${SERVICE_URL}"

# Test the health endpoint
echo "🔍 Testing health endpoint..."
if curl -f "${SERVICE_URL}/health" > /dev/null 2>&1; then
    echo "✅ Health check passed!"
else
    echo "⚠️  Health check failed. Please check the service logs."
fi

echo ""
echo "📋 Next steps:"
echo "1. Update your Stripe webhook URL to: ${SERVICE_URL}/webhooks/stripe"
echo "2. Update frontend environment variables in Cloudflare"
echo "3. Test the payment flow end-to-end"
echo ""
echo "🎉 Payment integration fixes deployed successfully!"
