Commands I used to get frontend and backend to work locally:
    In both terminals first:
        npm run build

    In backend terminal:
        npm run start:dev
    In frontend terminal:
        npm run dev



TO DO:

Backend Gaps

Frontend generation hooks call /api/unified-generate for every model (daygen0/src/hooks/useGeminiImageGeneration.ts:48, daygen0/src/hooks/useQwenImageGeneration.ts:59, daygen0/src/hooks/useIdeogramImageGeneration.ts:96), but Nest doesn’t expose that route yet; port the provider routing now handled in daygen0/server.js:1914 into a Nest GenerationController + service adapters (Gemini, Ideogram, Qwen, Runway, Seedream, ChatGPT, Reve, Recraft) with env-driven provider configs and structured error handling.
Flux tooling expects /api/flux/generate, /api/flux/result, /api/flux/download, /api/flux/webhook (daygen0/src/hooks/useFluxImageGeneration.ts:78, daygen0/src/hooks/useFluxImageGeneration.ts:151, daygen0/server.js:849); build a Nest module that wraps the BFL API (daygen0/src/lib/bfl.ts:97) with DTO validation, job polling, image re-hosting, and optional webhook secret verification.
Ideogram workflows rely on multipart endpoints (daygen0/src/hooks/useIdeogramImageGeneration.ts:160, daygen0/server.js:367); add authenticated Nest controllers for /ideogram/edit, /ideogram/reframe, /ideogram/replace-background, /ideogram/upscale, /ideogram/describe that proxy to the helper in daygen0/src/lib/ideogram.js and standardize JSON responses ({ dataUrls: string[] } etc.).
Qwen editing calls /api/qwen/image-edit with file uploads (daygen0/src/hooks/useQwenImageGeneration.ts:122, daygen0/server.js:1191); surface that route in Nest (plus /api/qwen/image if desired) with Multer handling, Ark/DashScope client integration, and consistent base64 payloads.
Generated assets need automatic persistence: after any generation succeeds, post the image + metadata into GalleryService.create (daygen-backend/src/gallery/gallery.service.ts:23) so the profile gallery (daygen0/src/lib/galleryApi.ts:18) stays in sync, and capture provider/model prompts for later retrieval.
Credits are displayed to the user (daygen0/components/Navbar.tsx:258) but never updated; implement a usage ledger that decrements user.credits per generation and exposes an admin-facing balance endpoint (daygen-backend/src/users/users.service.ts:14) with soft limits and optional grace logic.
Codex Prompts

“Add a Nest GenerationModule exposing POST /unified-generate; create provider-specific services (Gemini, Qwen, Runway, Seedream, ChatGPT, Reve, Recraft, Ideogram) that mirror daygen0/server.js:1914 logic, accept DTO-validated requests, and return structured JSON used by the React hooks.”
“Implement FluxModule with POST /flux/generate, GET /flux/result, GET /flux/download, and POST /flux/webhook; reuse daygen0/src/lib/bfl.ts helpers, inject config via ConfigModule, and cover rate-limit/credit errors with typed exceptions and e2e tests.”
“Create IdeogramModule and QwenModule controllers to handle multipart edit/reframe requests from the frontend hooks; integrate nestjs/multer, pass files to the existing client utilities, and return { dataUrls: string[] } payloads.”
“Extend gallery + users services so generation responses persist to Prisma (GalleryEntry + prompt metadata) and adjust credit balances in a database transaction; expose /usage/events for audit and guard it with JWT + role checks.”
Future Ideas

Layer a usage/credit accounting service with top-ups, Stripe billing hooks, and monthly grant resets so pricing tiers in the UI become enforceable entitlements.
Introduce project/workspace entities that group templates, galleries, and prompt histories for teams, enabling shared assets and collaborative editing queues.
Add async job orchestration (BullMQ/SQS) so long-running generations execute off-thread, optionally streaming status via WebSockets or SSE to replace polling.
Provide analytics endpoints for prompt effectiveness, model success rates, and latency, feeding in-app insights or admin dashboards.
Offer model-agnostic prompt templates and auto-tuning: store heuristics per provider and expose an endpoint that suggests prompt tweaks based on past results.