#!/bin/bash

# Setup Google Cloud authentication for local development
# This script helps configure authentication for local development

set -e

echo "🔐 Setting up Google Cloud authentication for local development..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "🔑 Please authenticate with Google Cloud:"
    gcloud auth login
fi

# Set the project
PROJECT_ID="daygen-backend"
echo "📋 Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "🔧 Enabling required Google Cloud APIs..."
gcloud services enable cloudtasks.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable iam.googleapis.com

# Create service account for local development
SERVICE_ACCOUNT_NAME="daygen-local-dev"
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"

echo "👤 Creating service account for local development..."

# Check if service account already exists
if gcloud iam service-accounts describe $SERVICE_ACCOUNT_EMAIL &> /dev/null; then
    echo "✅ Service account $SERVICE_ACCOUNT_EMAIL already exists"
else
    # Create service account
    gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
        --display-name="DayGen Local Development" \
        --description="Service account for local development"
    
    echo "✅ Created service account: $SERVICE_ACCOUNT_EMAIL"
fi

# Grant necessary permissions
echo "🔑 Granting necessary permissions..."

# Cloud Tasks permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/cloudtasks.enqueuer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/cloudtasks.viewer"

# Cloud Run permissions (for task processing)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/run.invoker"

echo "✅ Permissions granted"

# Create and download service account key
KEY_FILE="service-account-key.json"
echo "🔑 Creating service account key..."

if [ -f "$KEY_FILE" ]; then
    echo "✅ Service account key already exists: $KEY_FILE"
else
    gcloud iam service-accounts keys create $KEY_FILE \
        --iam-account=$SERVICE_ACCOUNT_EMAIL
    
    echo "✅ Created service account key: $KEY_FILE"
fi

# Set up environment variables
echo "📝 Setting up environment variables..."
echo ""
echo "Add these environment variables to your .env file:"
echo ""
echo "# Google Cloud Configuration"
echo "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
echo "GOOGLE_CLOUD_LOCATION=europe-central2"
echo "GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json"
echo "API_BASE_URL=http://localhost:3000"
echo "INTERNAL_API_KEY=internal-key"
echo ""

# Create .env.local file with the configuration
ENV_FILE=".env.local"
cat > $ENV_FILE << EOF
# Google Cloud Configuration for Local Development
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
GOOGLE_CLOUD_LOCATION=europe-central2
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
API_BASE_URL=http://localhost:3000
INTERNAL_API_KEY=internal-key
EOF

echo "✅ Created $ENV_FILE with local development configuration"
echo ""
echo "🎉 Local authentication setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure to add $ENV_FILE to your .gitignore"
echo "2. Run the application with: npm run start:dev"
echo "3. The service account key ($KEY_FILE) should be kept secure and not committed to version control"
