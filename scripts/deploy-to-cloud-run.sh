#!/bin/bash

# Deploy backend to Google Cloud Run
# Make sure you have gcloud CLI installed and authenticated

set -e

# Configuration
PROJECT_ID="daygen-backend-365299591811"
SERVICE_NAME="daygen-backend"
REGION="europe-central2"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Starting deployment to Google Cloud Run..."
echo "Project ID: $PROJECT_ID"
echo "Service Name: $SERVICE_NAME"
echo "Region: $REGION"
echo "Image: $IMAGE_NAME"

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated with gcloud. Please run 'gcloud auth login' first."
    exit 1
fi

# Set the project
echo "📋 Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Build the Docker image
echo "🔨 Building Docker image..."
docker build -t $IMAGE_NAME:latest .

# Push the image to Google Container Registry
echo "📤 Pushing image to Google Container Registry..."
docker push $IMAGE_NAME:latest

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME:latest \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 3000 \
    --memory 1Gi \
    --cpu 1 \
    --max-instances 10 \
    --set-env-vars "NODE_ENV=production" \
    --set-env-vars "PORT=3000"

echo "✅ Deployment completed!"
echo "🌐 Service URL: https://$SERVICE_NAME-$PROJECT_ID.a.run.app"
