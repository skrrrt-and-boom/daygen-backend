# Smoke Scripts

Minimal end-to-end checks for core platform health.

## Commands

```bash
npm run smoke:server     # starts small helper server to add credits to a test user
npm run smoke:db         # connect DB, create/delete user+job
npm run smoke:payments   # CRUD payment/subscription rows + cleanup
npm run smoke:queue      # basic auth + job endpoints sanity
npm run smoke:generate   # create a real image-generation job and poll
npm run smoke:frontend   # R2 config + frontend accessibility checks
npm run smoke:auth       # Google OAuth endpoints sanity
```

Ensure `.env` is set (see `docs/ENV_EXAMPLE.md`). Some scripts require the backend running at `http://localhost:3000` and frontend at `http://localhost:5173`.


