#!/bin/bash

# Setup Cloud Tasks queues for different job types
# Make sure you have gcloud CLI installed and authenticated

set -e

# Configuration
PROJECT_ID="daygen-backend"
LOCATION="europe-central2"

echo "🚀 Setting up Cloud Tasks queues..."
echo "Project ID: $PROJECT_ID"
echo "Location: $LOCATION"

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

# Create queues for different job types
QUEUES=(
    "image-generation-queue"
    "video-generation-queue"
    "image-upscale-queue"
    "batch-generation-queue"
)

for queue in "${QUEUES[@]}"; do
    echo "🔧 Creating queue: $queue"
    
    # Check if queue already exists
    if gcloud tasks queues describe $queue --location=$LOCATION &> /dev/null; then
        echo "✅ Queue $queue already exists"
    else
        # Create the queue
        gcloud tasks queues create $queue \
            --location=$LOCATION \
            --max-dispatches-per-second=10 \
            --max-concurrent-dispatches=100 \
            --max-attempts=3 \
            --max-retry-duration=3600s
        
        echo "✅ Created queue: $queue"
    fi
done

echo "🎉 All Cloud Tasks queues are ready!"
echo ""
echo "Available queues:"
for queue in "${QUEUES[@]}"; do
    echo "  - $queue"
done
