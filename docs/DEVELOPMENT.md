# [Archived] Development Guide

This document has been consolidated into `docs/BACKEND_GUIDE.md`.

The content below is preserved for reference.

## Quick Start

### Using Safe Development Scripts

The backend now includes safe development scripts that automatically handle port conflicts:

```bash
# Start development server (automatically kills existing process if needed)
npm run start:dev:safe

# Kill any existing process on port 3000
npm run dev:kill

# Check if port 3000 is in use
npm run dev:check

# Restart development server
npm run dev:restart
```

### Manual Commands

If you prefer to manage the server manually:

```bash
# Kill existing process on port 3000
kill -9 $(lsof -ti:3000)

# Start development server
npm run start:dev
```

## Common Issues

### Port Already in Use (EADDRINUSE)

If you see the error `Error: listen EADDRINUSE: address already in use :::3000`, it means another process is using port 3000.

**Solution 1: Use the safe script**
```bash
npm run start:dev:safe
```

**Solution 2: Manual fix**
```bash
# Find and kill the process
lsof -ti:3000 | xargs kill -9

# Then start the server
npm run start:dev
```

## Environment Variables

Make sure to set up your environment variables in `.env` file:

```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@host:port/database?pgbouncer=true
DIRECT_URL=postgresql://username:password@host:port/database
SHADOW_DATABASE_URL=postgresql://username:password@host:port/shadow_db

# Authentication
JWT_SECRET=your-super-secure-jwt-key-32-chars-minimum
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Storage Configuration
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_URL=https://your-bucket.r2.dev

# Payment Processing
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
FRONTEND_URL=http://localhost:5173

# Google Cloud Tasks
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=europe-central2
API_BASE_URL=http://localhost:3000
INTERNAL_API_KEY=your-internal-api-key

# AI Provider API Keys (optional, only for providers you want to use)
BFL_API_KEY=your-bfl-api-key
GEMINI_API_KEY=your-gemini-api-key
IDEOGRAM_API_KEY=your-ideogram-api-key
DASHSCOPE_API_KEY=your-dashscope-api-key
RUNWAY_API_KEY=your-runway-api-key
OPENAI_API_KEY=your-openai-api-key
REVE_API_KEY=your-reve-api-key
RECRAFT_API_KEY=your-recraft-api-key
LUMA_API_KEY=your-luma-api-key

# Server Configuration
PORT=3000
NODE_ENV=development
```

## API Endpoints

### Health & Monitoring
- `GET /health` - Health check endpoint
- `GET /api` - API status

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
- `POST /api/users/me/profile-picture` - Upload profile picture
- `POST /api/users/me/remove-profile-picture` - Remove profile picture

### Image Generation
- `POST /api/image/gemini` - Gemini 3 Pro image generation
- `POST /api/image/flux` - FLUX model generation
- `POST /api/image/gemini` - Gemini generation
- `POST /api/image/ideogram` - Ideogram generation
- `POST /api/image/runway` - Runway generation
- `POST /api/image/recraft` - Recraft generation
- `POST /api/image/reve` - Reve generation
- `POST /api/image/luma` - Luma AI generation

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
- `POST /api/payments/cancel-subscription` - Cancel subscription
- `GET /api/payments/history` - Get payment history

## Troubleshooting

### Server won't start
1. Check if port 3000 is in use: `npm run dev:check`
2. Kill existing process: `npm run dev:kill`
3. Try starting again: `npm run start:dev:safe`

### API errors
- Check that required environment variables are set
- Verify API keys are valid and have proper permissions
- Check server logs for detailed error messages

### Database issues
- Ensure PostgreSQL is running
- Check DATABASE_URL is correct
- Run migrations if needed: `npx prisma migrate deploy`
