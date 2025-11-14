# Environment Variables Configuration

This file contains all the environment variables needed for the DayGen backend application.

## Backend Environment Variables (.env)

Create a `.env` file in the backend root directory with the following variables:

```env
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/daygen"
DIRECT_URL="postgresql://username:password@localhost:5432/daygen"
SHADOW_DATABASE_URL="postgresql://username:password@localhost:5432/daygen_shadow"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-here"

# Supabase Configuration
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"
SUPABASE_JWT_SECRET="your-base64-encoded-jwt-secret"

# Stripe Configuration
# Get these from Stripe Dashboard → Developers → API keys
STRIPE_SECRET_KEY="sk_test_your_secret_key_here"
STRIPE_PUBLISHABLE_KEY="pk_test_your_publishable_key_here"
STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret_here"

# Frontend URL (for payment redirects)
FRONTEND_URL="http://localhost:5173"

# Stripe Price IDs (get from Stripe Dashboard → Products)
# One-time credit packages
STRIPE_TEST_PRICE_ID="price_test_10_credits"
STRIPE_STARTER_PRICE_ID="price_starter_100_credits"
STRIPE_POPULAR_PRICE_ID="price_popular_500_credits"
STRIPE_BEST_VALUE_PRICE_ID="price_best_value_1000_credits"

# Subscription plans (monthly)
STRIPE_PRO_PRICE_ID="price_pro_monthly"
STRIPE_ENTERPRISE_PRICE_ID="price_enterprise_monthly"

# Subscription plans (yearly)
STRIPE_PRO_YEARLY_PRICE_ID="price_pro_yearly"
STRIPE_ENTERPRISE_YEARLY_PRICE_ID="price_enterprise_yearly"

# Cloudflare R2 Configuration
CLOUDFLARE_R2_ACCOUNT_ID="your-account-id"
CLOUDFLARE_R2_ACCESS_KEY_ID="your-access-key-id"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-secret-access-key"
CLOUDFLARE_R2_BUCKET_NAME="your-bucket-name"
CLOUDFLARE_R2_PUBLIC_URL="https://your-public-url.r2.dev"

# Image Generation Services
# Add your other service configurations here...

# Voice Generation
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
```

## Frontend Environment Variables (.env)

Create a `.env` file in the frontend root directory with the following variables:

```env
# Stripe Configuration
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_your_publishable_key_here"

# API Configuration
VITE_API_URL="http://localhost:3000/api"
```

## Variable Descriptions

### Database Variables
- `DATABASE_URL`: Main database connection string
- `DIRECT_URL`: Direct database connection (for migrations)
- `SHADOW_DATABASE_URL`: Shadow database for Prisma migrations

### Authentication Variables
- `JWT_SECRET`: Secret key for JWT token signing
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `SUPABASE_JWT_SECRET`: Base64-encoded JWT secret from Supabase (found in Supabase Dashboard → Settings → API → JWT Secret)

### Stripe Variables
- `STRIPE_SECRET_KEY`: Stripe secret key (server-side only)
- `STRIPE_PUBLISHABLE_KEY`: Stripe publishable key (client-side safe)
- `STRIPE_WEBHOOK_SECRET`: Webhook signing secret for verification
- `FRONTEND_URL`: URL where frontend is hosted (for payment redirects)

### Stripe Price IDs
These are obtained from the Stripe Dashboard after creating products:
- `STRIPE_TEST_PRICE_ID`: Price ID for test pack (10 credits, $0.01)
- `STRIPE_STARTER_PRICE_ID`: Price ID for starter pack (100 credits, $10.00)
- `STRIPE_POPULAR_PRICE_ID`: Price ID for popular pack (500 credits, $40.00)
- `STRIPE_BEST_VALUE_PRICE_ID`: Price ID for best value pack (1000 credits, $70.00)
- `STRIPE_PRO_PRICE_ID`: Price ID for pro subscription (1000 credits/month, $29.00)
- `STRIPE_ENTERPRISE_PRICE_ID`: Price ID for enterprise subscription (5000 credits/month, $99.00)
- `STRIPE_PRO_YEARLY_PRICE_ID`: Price ID for pro subscription (12000 credits/year, $290.00)
- `STRIPE_ENTERPRISE_YEARLY_PRICE_ID`: Price ID for enterprise subscription (60000 credits/year, $990.00)

### Voice Generation
- `ELEVENLABS_API_KEY`: ElevenLabs API key used for voice cloning and text-to-speech features.

## Security Notes

1. **Never commit `.env` files to version control**
2. **Keep Stripe secret keys secure** - they provide full access to your Stripe account
3. **Use different keys for test and production environments**
4. **Rotate keys regularly in production**

## Getting Stripe Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **API keys**
3. Copy the **Publishable key** and **Secret key**
4. For webhook secret, create a webhook endpoint first (see STRIPE_SETUP.md)
