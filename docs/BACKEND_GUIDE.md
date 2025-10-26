# DayGen Backend Guide

> One-page practical guide for developing, testing, and operating the DayGen backend. For the full architecture map, see `../../backend.md`.

---

## Quick Start

```bash
# install
npm ci

# start dev server (safe: resolves port conflicts)
npm run start:dev:safe

# health check
curl -s http://localhost:3000/health | jq
```

Handy dev scripts:

```bash
npm run dev:check     # show process using port 3000
npm run dev:kill      # kill process on port 3000
npm run dev:restart   # restart dev server
```

---

## Environment Setup

- Use `docs/ENV_EXAMPLE.md` as the canonical reference for all variables.
- Minimum required in `.env` for local dev:

```env
DATABASE_URL=postgresql://user:pass@host:5432/db?pgbouncer=true
DIRECT_URL=postgresql://user:pass@host:5432/db
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
JWT_SECRET=dev-secret

# R2 (optional locally)
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_BUCKET_NAME=...
CLOUDFLARE_R2_PUBLIC_URL=https://<bucket>.r2.dev

# Payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:5173

# Queue / internal
ENABLE_CLOUD_TASKS=false
GOOGLE_CLOUD_PROJECT=your-project
GOOGLE_CLOUD_LOCATION=europe-central2
API_BASE_URL=http://localhost:3000
INTERNAL_API_KEY=dev-internal-key
```

---

## API Overview (essentials)

- Auth: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- Users: `GET|POST|PATCH /api/users/me`
- Generation: `POST /api/image/<provider>` e.g. `gemini`, `flux`, `ideogram`, `runway`, `recraft`, `reve`, `luma`, `qwen`, `seedream`
- Jobs: `POST /api/jobs/[image-generation|video-generation|image-upscale|batch-generation]`, `GET /api/jobs/:jobId`, `GET /api/jobs`
- Uploads/R2: `GET /api/upload/status`, `POST /api/upload/file|base64|presigned|delete`, `r2files` CRUD
- Payments: `POST /api/payments/create-checkout`, `GET /api/payments/history`, `GET /api/payments/subscription`, `POST /api/payments/subscription/*`
- Health: `GET /health`, `GET /api/health/queues`, `GET /api/health/queues/metrics`

See `../../backend.md` for the complete endpoint map.

---

## Queue System (Google Cloud Tasks)

Enable Cloud Tasks (optional locally):

```env
ENABLE_CLOUD_TASKS=true
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=europe-central2
API_BASE_URL=https://<cloud-run-url>
INTERNAL_API_KEY=<strong-random>
```

Setup helpers:

```bash
# local auth & queues
./scripts/setup-local-auth.sh
./scripts/setup-cloud-tasks-queues.sh

# health
curl http://localhost:3000/api/health/queues | jq
curl http://localhost:3000/api/health/queues/metrics
```

Processing flow (summary): API creates job → Cloud Task enqueues → `POST /api/jobs/process` (internal, secured by `INTERNAL_API_KEY`) → WebSocket updates → result stored to R2/DB.

Deep dive: `docs/QUEUE_SYSTEM.md` and `docs/QUEUE_DEBUGGING_GUIDE.md`.

---

## Payments (Stripe) Quick Start

Required products and price IDs: see `docs/STRIPE_QUICK_START.md`.

Essentials:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TEST_PRICE_ID=price_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_POPULAR_PRICE_ID=price_...
STRIPE_BEST_VALUE_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
FRONTEND_URL=http://localhost:5173
```

Local webhook forwarding:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Troubleshooting and full checklist: `docs/STRIPE_QUICK_START.md` and `../STRIPE_SETUP.md`.

---

## Deployment (pointer)

Production guide (Cloud Run, IAM, queues): `docs/PRODUCTION_DEPLOYMENT.md`.

Minimum production env: same as above, plus `NODE_ENV=production`, strong secrets, and Cloud Run service account with Cloud Tasks roles.

---

## Observability

- Structured logs (Pino) and request correlation IDs
- Metrics at `GET /api/health/queues/metrics` (Prometheus exposition)
- Useful endpoints: queue health, job debug (`GET /api/health/queues/job/:jobId/debug`)

See: `docs/QUEUE_DEBUGGING_GUIDE.md`.

---

## References

- Architecture map: `../../backend.md`
- Env template: `docs/ENV_EXAMPLE.md`
- Queue system: `docs/QUEUE_SYSTEM.md`
- Payments: `docs/STRIPE_QUICK_START.md`, `../STRIPE_SETUP.md`
- Deployment: `docs/PRODUCTION_DEPLOYMENT.md`


