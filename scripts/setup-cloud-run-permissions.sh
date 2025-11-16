#!/bin/bash

# Setup Cloud Run service account permissions for Cloud Tasks
# This script configures the Cloud Run service account with the required IAM roles

set -e

# Configuration
PROJECT_ID="daygen-backend"
SERVICE_NAME="daygen-backend"
REGION="europe-central2"

echo "🔐 Setting up Cloud Run service account permissions..."
echo "Project ID: $PROJECT_ID"
echo "Service Name: $SERVICE_NAME"
echo "Region: $REGION"

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

# Get the Cloud Run service account email
echo "🔍 Getting Cloud Run service account..."
SERVICE_ACCOUNT_EMAIL=$(gcloud run services describe $SERVICE_NAME \
  --region=$REGION \
  --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")

# If no custom service account is set, use the default compute service account
if [ -z "$SERVICE_ACCOUNT_EMAIL" ]; then
  SERVICE_ACCOUNT_EMAIL="${PROJECT_ID}-compute@developer.gserviceaccount.com"
  echo "📝 Using default compute service account: $SERVICE_ACCOUNT_EMAIL"
else
  echo "📝 Using custom service account: $SERVICE_ACCOUNT_EMAIL"
fi

# Grant required permissions
echo "🔑 Granting required IAM roles..."

# Cloud Tasks permissions
echo "  - Granting Cloud Tasks enqueuer role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/cloudtasks.enqueuer" \
  --quiet

echo "  - Granting Cloud Tasks viewer role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/cloudtasks.viewer" \
  --quiet

# Cloud Run permissions (for task processing)
echo "  - Granting Cloud Run invoker role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/run.invoker" \
  --quiet

echo "✅ All permissions granted successfully!"
echo ""
echo "🎉 Cloud Run service account is now configured with:"
echo "  - roles/cloudtasks.enqueuer"
echo "  - roles/cloudtasks.viewer" 
echo "  - roles/run.invoker"
echo ""
echo "The service account $SERVICE_ACCOUNT_EMAIL can now:"
echo "  - Create and manage Cloud Tasks"
echo "  - Invoke Cloud Run services"
echo "  - Process job queues"
echo ""
echo "💡 Note: Cloud Run uses Application Default Credentials automatically."
echo "   No GOOGLE_APPLICATION_CREDENTIALS environment variable is needed."
