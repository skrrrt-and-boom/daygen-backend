#!/bin/bash

# Update existing Google Cloud Run deployment for DayGen Backend
# This script will build and deploy updates to your existing service

set -e

# Configuration - Update these values
PROJECT_ID="your-project-id"  # Replace with your actual project ID
SERVICE_NAME="daygen-backend"
REGION="us-central1"  # Replace with your actual region
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Updating DayGen Backend on Google Cloud Run..."

# Check if gcloud is installed and authenticated
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Please authenticate with gcloud first: gcloud auth login"
    exit 1
fi

# Set the project
echo "📋 Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Build and push the Docker image
echo "🐳 Building and pushing updated Docker image..."
gcloud builds submit --tag $IMAGE_NAME .

# Deploy the updated image to Cloud Run
echo "🚀 Deploying updated image to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION

echo "✅ Update complete!"
echo "🌐 Service URL: https://$SERVICE_NAME-$REGION-$PROJECT_ID.a.run.app"

# Display the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
echo "🔗 Your updated service is available at: $SERVICE_URL"
