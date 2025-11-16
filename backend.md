# daygen.ai — Backend Architecture Map (backend.md)

> **Purpose**: Give you (and any AI agent) a compact, deterministic map of the DayGen backend so you can trace how things work, extend features safely, and avoid spaghetti code.

---

## 0) TL;DR mental model

- **Framework**: NestJS 11 + TypeScript; Prisma + PostgreSQL.
- **Auth**: Supabase Auth JWT; `JwtAuthGuard` via `JwtStrategy` using `SUPABASE_JWT_SECRET`.
- **API prefix**: `/api` global prefix; exceptions: `/health`, `/` root, `/webhooks/stripe`.
- **Generation**: Provider routes under `/api/image/*` (e.g., `POST /api/image/gemini`, `POST /api/image/flux`) that enqueue jobs.
- **Storage**: Cloudflare R2 (presigned uploads, base64 uploads); metadata in DB.
- **Queue**: Google Cloud Tasks (optional) or inline processor; internal `/api/jobs/process` secured via `INTERNAL_API_KEY`.
- **Payments**: Stripe checkout + webhooks; subscription support; credit packs; webhook at `/webhooks/stripe`.

---

## 1) Key folders & what they do

```text
src/
├─ auth/                 # Supabase auth, JwtStrategy, guards, DTOs, auth.controller.ts
├─ users/                # Profiles (create/update), credits exposure, admin balance listing
├─ generation/           # Provider-specific routes, controller, generation.service.ts
├─ jobs/                 # Cloud Tasks client, job processor controller, WebSocket gateway, job CRUD/status
├─ payments/             # Stripe service, payments.controller.ts, public-payments.controller.ts, stripe-webhook.controller.ts
├─ r2files/              # File metadata CRUD for R2 assets
├─ upload/                # R2 upload service, presigned URLs, base64 ingestion, delete & migration helpers
├─ usage/                # Admin-only usage events API
├─ health/               # Health checks (DB optional), queue health
├─ prisma/               # Prisma module/service
├─ supabase/             # Supabase clients, token-user resolution helper
├─ main.ts               # App bootstrap, CORS, global prefix, logging
└─ app.module.ts         # Module imports, ConfigModule, Pino logger
```

### Most "called" files
- **App bootstrap**: `src/main.ts`
- **Module wiring**: `src/app.module.ts`
- **Auth controller**: `src/auth/auth.controller.ts` (signup/login/me/oauth)
- **Generation service**: `src/generation/generation.service.ts` (provider-specific generation logic)
- **Cloud Tasks**: `src/jobs/cloud-tasks.service.ts` (job queue management)
- **Stripe webhook**: `src/payments/stripe-webhook.controller.ts` (payment processing)
- **R2 upload**: `src/upload/upload.controller.ts` (file uploads)

---

## 2) Global app wiring

- **App module**: `src/app.module.ts` loads ConfigModule, Pino logger, Prisma/Auth/Users/R2Files/Health/Generation/Upload/Jobs/Payments modules.
- **Main bootstrap**: `src/main.ts` sets global prefix `/api` with exclusions, enables CORS for local + prod origins, sets ValidationPipe, large body limits (50MB), and long timeouts (10 min).

---

## 3) Auth model

- **JWT extraction**: From `Authorization: Bearer <token>` header.
- **JwtStrategy**: Uses `SUPABASE_JWT_SECRET` (HS256); validates `payload.role==='authenticated'`; upserts local user from Supabase if missing.
- **Auth endpoints**: `POST /api/auth/signup`, `/login`, `/forgot-password`, `/reset-password`, `/magic-link`, `/google/verify`, `GET /api/auth/me`, `POST /api/auth/oauth-callback`, `/signout`.

### Minimal client contract

```ts
// Pseudocode
const token = getTokenFromAuthContextOrLocalStorage();
await fetch(`${getApiUrl()}/api/auth/me`, {
  headers: { Authorization: `Bearer ${token}` }
}); // returns profile incl. credits
```

---

## 4) Generation flow

- **Provider-specific routes**: Each AI provider has its own endpoint under `/api/image/*` (e.g., `POST /api/image/gemini`, `POST /api/image/flux`, etc.)
- **Job enqueueing**: Most providers enqueue jobs via `CloudTasksService` with model allow-lists and defaults (flux, ideogram, qwen, runway, seedream, reve, recraft, luma)
- **Gemini special handling**: Supports both inline and queued processing based on `providerOptions` flags (`useQueue`, `useInline`)
- **Deprecated endpoint**: `POST /api/unified-generate` returns `410 Gone` - use provider-specific routes instead

**Payload sketch**

```jsonc
POST /api/image/gemini
{
  "prompt": "A surreal rainy city at night",
  "model": "gemini-2.5-flash-image",
  "imageBase64": "data:image/png;base64,...",      // optional
  "references": ["data:image/png;base64,..."],     // optional
  "providerOptions": { 
    "useQueue": false,  // Gemini inline vs queued flag
    /* other per-model advanced options */ 
  }
}
```

---

## 5) Job & queue system

- **CloudTasksService**: Toggled by `ENABLE_CLOUD_TASKS=true`. Uses queues per `JobType` and calls internal `/api/jobs/process` with `Authorization: Bearer <INTERNAL_API_KEY>`.
- **Local processing**: Inline processor when Cloud Tasks disabled.
- **Job management**: `JobsController` creates image/video/upscale/batch jobs; lists and fetches status.
- **Task processing**: `TaskProcessorController` processes tasks by job type.
- **Real-time**: `jobs.gateway.ts` provides socket events for status updates.

---

## 6) Storage & uploads (Cloudflare R2)

- **Status check**: `GET /api/upload/status` for configuration sanity check.
- **File uploads**: `POST /api/upload/file` (multipart) and `POST /api/upload/base64` (JWT) → upload to R2, create `R2File` record.
- **Presigned URLs**: `POST /api/upload/presigned` to obtain presigned URL + public URL.
- **File deletion**: `POST /api/upload/delete` by public URL.
- **Migration**: `POST /api/upload/migrate-base64-batch` to migrate multiple base64 images into R2 + records.
- **File metadata**: `r2files` resource (JWT) for list/create/delete user-owned file metadata.

---

## 7) Payments

- **Protected endpoints**: `payments` (JWT) for `POST /api/payments/create-checkout`, `GET /api/payments/history`, `GET /api/payments/subscription`, `POST /api/payments/subscription/*` helpers, and testing utilities.
- **Public endpoints**: `public-payments` for read-only configs and session status.
- **Webhook**: `webhooks/stripe` raw-body webhook handler, updates payments/subscriptions/credits.

---

## 8) Endpoint map (what mounts where)

| Path | Method | Notes |
|------|--------|-------|
| `/health` | GET | Health check (DB optional) |
| `/api/auth/signup` | POST | Create account with email/password |
| `/api/auth/login` | POST | Login with email/password |
| `/api/auth/forgot-password` | POST | Request password reset |
| `/api/auth/reset-password` | POST | Reset password |
| `/api/auth/magic-link` | POST | Send magic link |
| `/api/auth/google/verify` | POST | Google OAuth verification |
| `/api/auth/oauth-callback` | POST | Handle OAuth callbacks |
| `/api/auth/callback` | GET | Auth callback (magic links, email confirmations) |
| `/api/auth/me` | GET | Get current user profile |
| `/api/auth/signout` | POST | Sign out |
| `/api/users/me` | GET/POST/PATCH | User profile CRUD |
| `/api/users/me/profile-picture` | POST | Upload profile picture |
| `/api/users/me/remove-profile-picture` | POST | Remove profile picture |
| `/api/users/balances` | GET | Admin: list user balances |
| `/api/image/gemini` | POST | Gemini generation |
| `/api/image/flux` | POST | FLUX model generation |
| `/api/image/ideogram` | POST | Ideogram generation |
| `/api/image/runway` | POST | Runway generation |
| `/api/image/recraft` | POST | Recraft generation |
| `/api/image/reve` | POST | Reve generation |
| `/api/image/luma` | POST | Luma AI generation |
| `/api/image/qwen` | POST | Qwen generation |
| `/api/image/seedream` | POST | Seedream generation |
| `/api/image/chatgpt` | POST | ChatGPT generation |
| `/api/jobs/image-generation` | POST | Create image generation job |
| `/api/jobs/video-generation` | POST | Create video generation job |
| `/api/jobs/image-upscale` | POST | Create image upscale job |
| `/api/jobs/batch-generation` | POST | Create batch generation job |
| `/api/jobs/:jobId` | GET | Get job status |
| `/api/jobs` | GET | List user jobs |
| `/api/jobs/process` | POST | **Internal** task processor |
| `/api/r2files` | GET/POST | List/create R2 file metadata |
| `/api/r2files/:id` | DELETE | Delete R2 file metadata |
| `/api/upload/status` | GET | Upload configuration check |
| `/api/upload/file` | POST | Multipart file upload |
| `/api/upload/base64` | POST | Base64 image upload |
| `/api/upload/presigned` | POST | Generate presigned URL |
| `/api/upload/delete` | POST | Delete file by URL |
| `/api/upload/migrate-base64-batch` | POST | Batch migrate base64 images |
| `/api/usage/events` | GET | **Admin only** usage analytics |
| `/api/payments/create-checkout` | POST | Create Stripe checkout session |
| `/api/payments/history` | GET | Get payment history |
| `/api/payments/subscription` | GET | Get user subscription |
| `/api/payments/subscription/cancel` | POST | Cancel subscription |
| `/api/payments/subscription/remove-cancellation` | POST | Remove subscription cancellation |
| `/api/payments/subscription/upgrade` | POST | Upgrade subscription |
| `/api/payments/subscription-plans` | GET | List subscription plans |
| `/api/payments/session/:sessionId/status` | GET | Get session status |
| `/api/payments/find-by-intent/:paymentIntentId` | GET | Find payment by intent ID |
| `/api/public-payments/config` | GET | Public payment configs |
| `/api/public-payments/session/:sessionId` | GET | Public session status |
| `/api/health/queues` | GET | Queue health check |
| `/webhooks/stripe` | POST | **Stripe webhook** (no /api prefix) |

---

## 9) Database schema (Prisma overview)

- **User**: User accounts with credits, role, profile info
- **Job**: Async job tracking (type/status/progress/result) for generation tasks
- **R2File**: File metadata for Cloudflare R2 storage
- **Payment**: Payment records and transactions (one-time/subscription)
- **Subscription**: User subscription management
- **UsageEvent**: Credit usage tracking and analytics (cost/balanceAfter)

**Enums**: UserRole, JobType, JobStatus, PaymentStatus, PaymentType, SubscriptionStatus, UsageStatus

---

## 10) Environment variables (backend)

### Database
- `DATABASE_URL` - Main PostgreSQL connection
- `DIRECT_URL` - Direct PostgreSQL connection (migrations)
- `SHADOW_DATABASE_URL` - Shadow database for Prisma migrations

### Authentication
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `SUPABASE_JWT_SECRET` - JWT signing secret (primary)
- `JWT_SECRET` - Fallback JWT secret

### Payments
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `FRONTEND_URL` - Frontend URL for payment redirects

### Storage (Cloudflare R2)
- `CLOUDFLARE_R2_ACCOUNT_ID` - R2 account ID
- `CLOUDFLARE_R2_ACCESS_KEY_ID` - R2 access key
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` - R2 secret key
- `CLOUDFLARE_R2_BUCKET_NAME` - R2 bucket name
- `CLOUDFLARE_R2_PUBLIC_URL` - R2 public URL

### Server Configuration
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `SKIP_DATABASE_HEALTHCHECK` - Skip DB check in health endpoint (true/false)

### Queue (Google Cloud Tasks)
- `ENABLE_CLOUD_TASKS` - Enable/disable Cloud Tasks (true/false)
- `GOOGLE_CLOUD_PROJECT` - GCP project ID
- `GOOGLE_CLOUD_LOCATION` - GCP location
- `GOOGLE_APPLICATION_CREDENTIALS` - Service account key path
- `INTERNAL_API_KEY` - Internal API key for job processing
- `API_BASE_URL` - Base URL for internal API calls

---

## 11) Quick trace examples (copy/paste for agents)

**Health check**
```bash
curl -s http://localhost:3000/health
```

**Get current user & credits**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/auth/me
```

**Generate an image (provider-specific)**
```bash
# Note: model must match provider (e.g., flux-pro-1.1 for /api/image/flux)
curl -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"prompt":"cat","model":"flux-pro-1.1"}' \
  http://localhost:3000/api/image/flux
```

**Create checkout session**
```bash
curl -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"one_time","packageId":"starter"}' \
  http://localhost:3000/api/payments/create-checkout
```

**Get job status**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/jobs/$JOB_ID
```

**Upload base64 image**
```bash
curl -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"base64Data":"data:image/png;base64,...","mimeType":"image/png"}' \
  http://localhost:3000/api/upload/base64
```

---

## 12) Conventions that keep code clean

- **Only one place decides API base URL** → environment variables
- **Provider-specific endpoints for generation** → `/api/image/<provider>` keeps logic isolated
- **Auth token is always read from context** → avoid prop-drilling tokens
- **All protected endpoints use `JwtAuthGuard`** → consistent auth
- **Admin endpoints add `AdminGuard`** → role-based access
- **Body size limits increased (50MB)** → handle large gallery images
- **Server timeouts extended (10 min)** → long-running generation operations
- **Webhook uses raw body** → ensure route is not behind `/api` prefix

---

## 13) Next steps (if you're onboarding yourself)

- Ensure `.env` is configured (see backend `docs/ENV_EXAMPLE.md`).
- Run `npm run start:dev` in backend; point frontend to `VITE_API_BASE_URL`.
- Optionally enable Cloud Tasks in staging/production.
- Test auth flow: sign up → credits (20) → generate → see in gallery.
- Try local backend (set `VITE_API_BASE_URL=http://localhost:3000`) to iterate on APIs quickly.

---

## 14) Internal & Test Endpoints

### Internal (secured by INTERNAL_API_KEY)
- `POST /api/jobs/process` - Process queued jobs (called by Cloud Tasks or local processor)

### Test/Debug (development only)
- `POST /api/payments/test/complete-payment/:sessionId` - Manually complete test payment
- `POST /api/payments/test/create-manual-subscription` - Create manual subscription for testing
- `POST /api/payments/test/complete-by-intent/:paymentIntentId` - Complete payment by intent ID
- `GET /api/public-payments/test/url-config` - View URL configuration
- `GET /api/health/queues/job/:jobId/debug` - Debug info for specific job
- `GET /api/health/queues/metrics` - Queue processing metrics

---

*End of file.*
