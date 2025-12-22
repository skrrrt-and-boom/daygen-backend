# Cloud Run Deployment Variables

The following environment variables **MUST** be set in your Cloud Run service configuration for the application to start. Missing any of the "Required" variables will cause the container to exit immediately with an error (Exit Code 1).

## Core Configuration
| Variable | Description | Required |
|----------|-------------|:--------:|
| `NODE_ENV` | Set to `production` | ✅ |
| `PORT` | Set to `3000` (Cloud Run sets this automatically, but good to be explicit) | ✅ |

## Database
| Variable | Description | Required |
|----------|-------------|:--------:|
| `DATABASE_URL` | Transaction pooled connection string (port 6543) | ✅ |
| `DIRECT_URL` | Direct connection string for migrations/commands (port 5432) | ✅ |

## Authentication (Supabase)
| Variable | Description | Required |
|----------|-------------|:--------:|
| `SUPABASE_JWT_SECRET` | Used to verify JWT tokens from Supabase Auth | ✅ |
| `SUPABASE_URL` | Your Supabase project URL | ✅ |
| `SUPABASE_ANON_KEY` | Public anonymous key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (for admin tasks) | ✅ |

## Storage (Cloudflare R2)
| Variable | Description | Required |
|----------|-------------|:--------:|
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare Account ID | ✅ |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 Access Key ID | ✅ |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 Secret Access Key | ✅ |
| `CLOUDFLARE_R2_BUCKET_NAME` | Name of the bucket (e.g., `daygen-assets`) | ✅ |

## Stripe (Payments)
| Variable | Description | Required |
|----------|-------------|:--------:|
| `STRIPE_SECRET_KEY` | Secret key (starts with `sk_`) | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret (starts with `whsec_`) | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | Publishable key (starts with `pk_`) | ✅ |

### Stripe Price IDs (Required)
These specific Price IDs must be configured to match your Stripe dashboard.

- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_AGENCY_PRICE_ID`
- `STRIPE_STARTER_YEARLY_PRICE_ID`
- `STRIPE_PRO_YEARLY_PRICE_ID`
- `STRIPE_AGENCY_YEARLY_PRICE_ID`

### Stripe Price IDs (Optional/Top-ups)
- `STRIPE_STARTER_TOPUP_PRICE_ID`
- `STRIPE_PRO_TOPUP_PRICE_ID`
- `STRIPE_AGENCY_TOPUP_PRICE_ID`

## Google OAuth (Optional but Recommended)
| Variable | Description | Required |
|----------|-------------|:--------:|
| `GOOGLE_CLIENT_ID` | OAuth Client ID | ⚠️ |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret | ⚠️ |
