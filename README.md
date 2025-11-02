# DayGen Backend

See the concise guide at `docs/BACKEND_GUIDE.md` for day-to-day development, envs, queue, payments, and deployment pointers. For a full architecture map, open `./backend.md`.

A comprehensive NestJS backend service for the DayGen AI-powered content generation platform. Provides image and video generation, user authentication, payment processing, and gallery management.

## 🚀 Features

### Image Generation
- **FLUX Models**: Flux Pro 1.1, Ultra, Kontext Pro/Max via BFL API
- **Gemini 2.5 Flash**: Google's latest text-to-image model with experimental preview support
- **Ideogram V3**: Advanced text-to-image with turbo mode and style presets
- **Recraft v2/v3**: Professional image generation with multiple styles and editing capabilities
- **Reve**: Fast image generation, editing, and remixing with advanced controls
- **Qwen Image**: Alibaba's text-to-image generation via DashScope API
- **Runway Gen-4**: Professional image generation with cinematic quality
- **DALL·E 3**: OpenAI's image generation API with multiple model variants
- **Luma AI**: Dream Shaper, Realistic Vision, and Photon models for various styles
### Image Generation
- `POST /api/image/gemini` - Gemini 2.5 Flash image generation
- `POST /api/image/flux` - FLUX model generation
- `POST /api/image/ideogram` - Ideogram generation
- `POST /api/image/runway` - Runway generation
- `POST /api/image/recraft` - Recraft generation
- `POST /api/image/reve` - Reve generation
- `POST /api/image/luma` - Luma AI generation

### Video Generation
- **Veo 3**: Google's latest cinematic video generation with advanced prompting
- **Kling**: Advanced video generation with multiple models and camera controls
- **Runway Gen-4 Video**: Professional video generation with style consistency
- **Wan 2.2**: Alibaba's text-to-video generation with high quality output
- **Hailuo 02**: MiniMax video generation with frame control and editing
- **Seedance 1.0 Pro**: High-quality video generation with smooth motion
- **Luma Ray 2**: Professional video generation with advanced features

### Core Services
- **Authentication**: Supabase Auth + JWT with Google OAuth
- **Payment Processing**: Stripe integration for credits and subscriptions
- **File Storage**: Cloudflare R2 for image/video storage
- **Job Queue**: Google Cloud Tasks for async processing
- **Gallery Management**: User galleries with R2 storage
- **Usage Tracking**: Credit system and usage analytics
- **WebSocket Support**: Real-time job status updates

## 🛠️ Tech Stack

- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: Cloudflare R2
- **Queue**: Google Cloud Tasks
- **Payments**: Stripe
- **Auth**: Supabase + JWT
- **Deployment**: Google Cloud Run

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** (see Environment Configuration below)

3. **Set up database**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run development server**:
   ```bash
   npm run start:dev
   ```

## 📝 Environment Configuration

### Required Variables
- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection for migrations
- `JWT_SECRET` - Secret for JWT token signing
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

### Image Generation Providers
Configure API keys for the providers you want to use:

- `BFL_API_KEY` - Black Forest Labs (FLUX models)
- `GEMINI_API_KEY` - Google Gemini 2.5 Flash
- `IDEOGRAM_API_KEY` - Ideogram V3
- `DASHSCOPE_API_KEY` - Alibaba Qwen Image
- `RUNWAY_API_KEY` - Runway Gen-4
- `OPENAI_API_KEY` - OpenAI DALL·E
- `REVE_API_KEY` - Reve image generation
- `RECRAFT_API_KEY` - Recraft v2/v3
- `LUMA_API_KEY` - Luma AI models

### Storage & Services
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_PUBLIC_URL` - R2 public URL

### Payment Processing
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `FRONTEND_URL` - Frontend URL for redirects

### Google Cloud Tasks
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `GOOGLE_APPLICATION_CREDENTIALS` - Service account key path (local development only)

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account with email/password
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/google` - Google OAuth login
- `POST /api/auth/oauth-callback` - Handle OAuth callbacks
- `GET /api/auth/me` - Get current user profile
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

### User Management
- `GET /api/users/me` - Get current user profile
- `POST /api/users/me` - Create user profile
- `PATCH /api/users/me` - Update user profile

### Image Generation
- `POST /api/image/gemini` - Gemini 2.5 Flash image generation
- `POST /api/image/flux` - FLUX model generation
- `POST /api/image/gemini` - Gemini generation
- `POST /api/image/ideogram` - Ideogram generation
- `POST /api/image/runway` - Runway generation
- `POST /api/image/recraft` - Recraft generation
- `POST /api/image/reve` - Reve generation
- `POST /api/image/luma` - Luma AI generation

### Video Generation
- `POST /api/video/veo` - Google Veo 3 generation
- `POST /api/video/kling` - Kling video generation
- `POST /api/video/runway` - Runway video generation
- `POST /api/video/luma` - Luma video generation

### Job Management
- `POST /api/jobs/image-generation` - Create image generation job
- `POST /api/jobs/video-generation` - Create video generation job
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs` - List user jobs

### Gallery & Files
- `GET /api/r2files` - List user files
- `POST /api/r2files` - Upload file to R2
- `DELETE /api/r2files/:id` - Delete file

### Payments
- `POST /api/payments/create-checkout` - Create Stripe checkout session
- `GET /api/payments/subscription` - Get user subscription
- `POST /api/payments/subscription/upgrade` - Upgrade subscription
- `POST /api/payments/subscription/cancel` - Cancel subscription
- `GET /api/payments/history` - Get payment history

### Health & Monitoring
- `GET /health` - Health check endpoint
- `GET /api/usage/events` - Usage analytics (admin only)

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov

# Linting
npm run lint

# Build
npm run build
```

## 📊 Database Schema

The application uses PostgreSQL with Prisma ORM. Key models include:

- **User**: User accounts with credits and profile info
- **R2File**: File metadata for Cloudflare R2 storage
- **Job**: Async job tracking for generation tasks
- **Payment**: Payment records and transactions
- **Subscription**: User subscription management
- **UsageEvent**: Credit usage tracking and analytics

## 🚀 Deployment

The application is designed to deploy on Google Cloud Run with:

1. **Database**: PostgreSQL (Supabase or Cloud SQL)
2. **Storage**: Cloudflare R2
3. **Queue**: Google Cloud Tasks
4. **Monitoring**: Built-in health checks and logging

See `docs/PRODUCTION_DEPLOYMENT.md` for detailed deployment instructions.

## 📚 Documentation

<!-- docs:start -->
<!-- This section is auto-generated by scripts/update-docs-toc.js. Do not edit manually. -->
<!-- docs:end -->

## CI/CD

- Backend deploys automatically to Google Cloud Run on pushes to `main` via GitHub Actions (requires `GCP_CREDENTIALS` secret and proper service configuration).
- See `docs/PRODUCTION_DEPLOYMENT.md` for environment and deployment details.
