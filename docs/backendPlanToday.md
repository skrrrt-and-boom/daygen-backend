Commands I used to get frontend and backend to work locally:
    In both terminals first:
        npm run build

    In backend terminal:
        npm run start:dev
    In frontend terminal:
        npm run dev



TO DO:

Where we need to set up backend so it works with vercel hosted frontend already on https://www.daygen.ai/

finish migrating remaining generation endpoints out of daygen0/server.js so every model call flows through Nest (one source of truth, easier to secure).

introduce persistent storage (object store + CDN) instead of returning data URLs, so big libraries don’t sit in Postgres or memory.

queue long-running jobs with BullMQ/SQS and send status via webhooks or WebSockets; polling from the frontend will collapse under heavy load.

harden usage accounting: automated resets/top-ups, Stripe or internal billing hooks, rate-limits per provider, admin dashboards.

add structured logging/metrics (Pino to log shipper, tracing, error reporting) and integration tests that hit the new modules end-to-end.
