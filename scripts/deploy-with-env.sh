#!/bin/bash

# Deploy backend to Google Cloud Run with environment variables
# Make sure you have gcloud CLI installed and authenticated

set -e

# Configuration
PROJECT_ID="daygen-backend-365299591811"
SERVICE_NAME="daygen-backend"
REGION="europe-central2"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Starting deployment to Google Cloud Run with environment variables..."

# Load environment variables from .env files
if [ -f .env ]; then
    echo "📋 Loading environment variables from .env..."
    export $(cat .env | grep -v '^#' | xargs)
fi

if [ -f .env.image-services ]; then
    echo "📋 Loading API keys from .env.image-services..."
    export $(cat .env.image-services | grep -v '^#' | xargs)
fi

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
docker build --platform linux/amd64 -t $IMAGE_NAME:latest .

# Push the image to Google Container Registry
echo "📤 Pushing image to Google Container Registry..."
docker push $IMAGE_NAME:latest

# Prepare environment variables for Cloud Run
ENV_VARS="NODE_ENV=production"

# Add database variables
if [ ! -z "$DATABASE_URL" ]; then
    ENV_VARS="$ENV_VARS,DATABASE_URL=$DATABASE_URL"
fi
if [ ! -z "$DIRECT_URL" ]; then
    ENV_VARS="$ENV_VARS,DIRECT_URL=$DIRECT_URL"
fi

# Add JWT secret
if [ ! -z "$JWT_SECRET" ]; then
    ENV_VARS="$ENV_VARS,JWT_SECRET=$JWT_SECRET"
fi

# Add Supabase configuration
if [ ! -z "$SUPABASE_URL" ]; then
    ENV_VARS="$ENV_VARS,SUPABASE_URL=$SUPABASE_URL"
fi
if [ ! -z "$SUPABASE_ANON_KEY" ]; then
    ENV_VARS="$ENV_VARS,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY"
fi
if [ ! -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    ENV_VARS="$ENV_VARS,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
fi
if [ ! -z "$SUPABASE_JWT_SECRET" ]; then
    ENV_VARS="$ENV_VARS,SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET"
fi

# Add Google OAuth configuration
if [ ! -z "$GOOGLE_CLIENT_ID" ]; then
    ENV_VARS="$ENV_VARS,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
fi
if [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
    ENV_VARS="$ENV_VARS,GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
fi

# Add Cloudflare R2 variables
if [ ! -z "$CLOUDFLARE_R2_ACCOUNT_ID" ]; then
    ENV_VARS="$ENV_VARS,CLOUDFLARE_R2_ACCOUNT_ID=$CLOUDFLARE_R2_ACCOUNT_ID"
fi
if [ ! -z "$CLOUDFLARE_R2_ACCESS_KEY_ID" ]; then
    ENV_VARS="$ENV_VARS,CLOUDFLARE_R2_ACCESS_KEY_ID=$CLOUDFLARE_R2_ACCESS_KEY_ID"
fi
if [ ! -z "$CLOUDFLARE_R2_SECRET_ACCESS_KEY" ]; then
    ENV_VARS="$ENV_VARS,CLOUDFLARE_R2_SECRET_ACCESS_KEY=$CLOUDFLARE_R2_SECRET_ACCESS_KEY"
fi
if [ ! -z "$CLOUDFLARE_R2_BUCKET_NAME" ]; then
    ENV_VARS="$ENV_VARS,CLOUDFLARE_R2_BUCKET_NAME=$CLOUDFLARE_R2_BUCKET_NAME"
fi
if [ ! -z "$CLOUDFLARE_R2_PUBLIC_URL" ]; then
    ENV_VARS="$ENV_VARS,CLOUDFLARE_R2_PUBLIC_URL=$CLOUDFLARE_R2_PUBLIC_URL"
fi

# Add API keys
if [ ! -z "$GEMINI_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,GEMINI_API_KEY=$GEMINI_API_KEY"
fi
if [ ! -z "$OPENAI_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,OPENAI_API_KEY=$OPENAI_API_KEY"
fi
if [ ! -z "$BFL_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,BFL_API_KEY=$BFL_API_KEY"
fi
if [ ! -z "$IDEOGRAM_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,IDEOGRAM_API_KEY=$IDEOGRAM_API_KEY"
fi
if [ ! -z "$DASHSCOPE_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,DASHSCOPE_API_KEY=$DASHSCOPE_API_KEY"
fi
if [ ! -z "$RUNWAY_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,RUNWAY_API_KEY=$RUNWAY_API_KEY"
fi
if [ ! -z "$ARK_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,ARK_API_KEY=$ARK_API_KEY"
fi
if [ ! -z "$REVE_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,REVE_API_KEY=$REVE_API_KEY"
fi
if [ ! -z "$RECRAFT_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,RECRAFT_API_KEY=$RECRAFT_API_KEY"
fi
if [ ! -z "$LUMAAI_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,LUMAAI_API_KEY=$LUMAAI_API_KEY"
fi

# Add Stripe configuration
if [ ! -z "$STRIPE_SECRET_KEY" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY"
fi
if [ ! -z "$STRIPE_WEBHOOK_SECRET" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET"
fi
if [ ! -z "$STRIPE_PUBLISHABLE_KEY" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY"
fi

# Add Stripe Price IDs (CRITICAL FOR SUBSCRIPTIONS)
if [ ! -z "$STRIPE_PRO_PRICE_ID" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_PRO_PRICE_ID=$STRIPE_PRO_PRICE_ID"
fi
if [ ! -z "$STRIPE_ENTERPRISE_PRICE_ID" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_ENTERPRISE_PRICE_ID=$STRIPE_ENTERPRISE_PRICE_ID"
fi
if [ ! -z "$STRIPE_PRO_YEARLY_PRICE_ID" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_PRO_YEARLY_PRICE_ID=$STRIPE_PRO_YEARLY_PRICE_ID"
fi
if [ ! -z "$STRIPE_ENTERPRISE_YEARLY_PRICE_ID" ]; then
    ENV_VARS="$ENV_VARS,STRIPE_ENTERPRISE_YEARLY_PRICE_ID=$STRIPE_ENTERPRISE_YEARLY_PRICE_ID"
fi

# Add Frontend URL for payment redirects
if [ ! -z "$FRONTEND_URL" ]; then
    ENV_VARS="$ENV_VARS,FRONTEND_URL=$FRONTEND_URL"
fi

# Add Google Cloud Tasks configuration
if [ ! -z "$GOOGLE_CLOUD_PROJECT" ]; then
    ENV_VARS="$ENV_VARS,GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT"
fi
if [ ! -z "$GOOGLE_CLOUD_LOCATION" ]; then
    ENV_VARS="$ENV_VARS,GOOGLE_CLOUD_LOCATION=$GOOGLE_CLOUD_LOCATION"
fi
if [ ! -z "$API_BASE_URL" ]; then
    ENV_VARS="$ENV_VARS,API_BASE_URL=$API_BASE_URL"
fi
if [ ! -z "$INTERNAL_API_KEY" ]; then
    ENV_VARS="$ENV_VARS,INTERNAL_API_KEY=$INTERNAL_API_KEY"
fi

# Redis configuration removed - application now uses Cloud Tasks instead of BullMQ/Redis

echo "🔧 Environment variables configured:"
echo "$ENV_VARS" | tr ',' '\n' | sed 's/^/  /'

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
    --set-env-vars "$ENV_VARS"

echo "✅ Deployment completed!"
echo "🌐 Service URL: https://$SERVICE_NAME-$PROJECT_ID.europe-central2.run.app"
echo "📊 Check logs with: gcloud run logs tail $SERVICE_NAME --region=$REGION"
