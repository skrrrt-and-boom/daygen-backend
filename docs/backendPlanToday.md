Commands I used to get frontend and backend to work locally:
    In both terminals first:
        npm run build

    In backend terminal:
        npm run start:dev
    In frontend terminal:
        npm run dev



TO DO:
Add Ideogram and Qwen every feature
 The edit/reframe/upscale/describe (Ideogram) and image-edit (Qwen) variants were previously handled in daygen0/server.js, and since that server layer is now gone, there’s nothing on the backend to service those requests

---

introduce persistent storage (object store + CDN) instead of returning data URLs, so big libraries don’t sit in Postgres or memory.

1) Store big files in object storage + serve via CDN (no more data URLs)

Plainly: Don’t shove large assets (images, audio, big JSON libs) into Postgres or return them inline as data: URLs. Instead:
	•	Write files to an object store (e.g., S3, GCS, MinIO).
	•	Serve them through a CDN (CloudFront, Cloudflare) via a normal https://... URL.

Why:
	•	Databases and memory are expensive and slow for big binaries.
	•	CDNs are fast, cheap, and built for this.
	•	Clients get small JSON responses with links instead of megabytes of base64.

Done looks like
	•	Upload helper (streaming) writes to s3://bucket/key.
	•	API returns { url, contentType, size }, not data: blobs.
	•	Postgres only stores metadata (key, checksum, expiry), not the file.
	•	CDN headers (cache, content-type, range) are correctly set.

---

queue long-running jobs with BullMQ/SQS and send status via webhooks or WebSockets; polling from the frontend will collapse under heavy load.

3) Use a queue for long jobs; push status via events (no polling loops)

Plainly: If a job may take > a second (transcription, upscales, multi-step generation), enqueue it (BullMQ on Redis or SQS). Let a worker do the heavy lifting. Tell the frontend progress via webhooks or WebSockets. Avoid “Are we done yet?” polling from the browser.

Why: Polling hammers the server and collapses under load. Queues smooth spikes, retry failures, and let you scale workers separately.

Done looks like
	•	POST /jobs returns { jobId } immediately.
	•	A worker (separate process) consumes from BullMQ/SQS.
	•	Clients get updates either by:
	•	WebSocket: subscribe to job:{jobId} channel, or
	•	Webhook: we call the client’s URL with { status, progress, resultUrl }.
	•	Final results live in object storage; job record holds status and link.

---

harden usage accounting: automated resets/top-ups, Stripe or internal billing hooks, rate-limits per provider, admin dashboards.

4) Solid usage + billing controls

Plainly: Track how much each user/team/provider is using, enforce limits, and automate resets/payments.

Pieces:
	•	Usage ledger: write a row per call (who, provider, tokens/ms, cost).
	•	Rate limits: caps per user/org/provider (e.g., 60 req/min; 1M tokens/day).
	•	Resets/top-ups: auto monthly resets or auto-purchase more credits.
	•	Payments: Stripe webhooks or internal billing to sync balances.
	•	Admin dashboards: see spend, throttle/ban, grant credits, export reports.

Done looks like
	•	Pre-check before running a job: “do they have quota?” If no → 402/429.
	•	Post-record after the job: exact usage & cost written once.
	•	Automatic monthly reset job, and Stripe webhook updates balances.
	•	Admin UI with charts, filters, and manual adjustments.

---

add structured logging/metrics (Pino to log shipper, tracing, error reporting) and integration tests that hit the new modules end-to-end.

5) Real logs, metrics, tracing, and end-to-end tests

Plainly: Make it observable and testable:
	•	Structured logging: Use Pino. Every log line is JSON with keys (route, userId, jobId, latency, errorCode).
	•	Shipping logs: Send to a log stack (ELK, Loki, Datadog). Keep request IDs to correlate.
	•	Metrics: Counters and histograms (requests, queue depth, job time, errors) to Prometheus/Grafana (or similar).
	•	Tracing: Distributed traces (OpenTelemetry) across API → queue → worker → external provider.
	•	Integration tests: CI runs tests that hit the actual Nest endpoints, enqueue a job, run the worker, write to object storage, and assert outputs.

Done looks like
	•	You can answer “What failed yesterday at 14:32 for org X?” in minutes.
	•	A flame graph shows where time is spent (e.g., provider latency).
	•	A red dashboard tells you before customers do.
	•	CI green-check proves the whole path works, not just unit pieces.