# Image Generation Provider Reference

This cheat sheet pulls together the official API docs for every provider wired into `GenerationService`. Use it when onboarding new keys, checking request payloads, or diagnosing the `400 Bad Request` responses the frontend is currently surfacing.

| Provider | Backend handler | Required env vars | Official docs |
| --- | --- | --- | --- |
| Flux (Black Forest Labs) | `handleFlux` (`model` starts with `flux-`) | `BFL_API_KEY`, optional `BFL_API_BASE` | https://bfl.ai/api-reference |
| Google Gemini | `handleGemini` (`gemini-2.5-flash-image-preview`) | any of `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_AI_KEY`, `VITE_GEMINI_API_KEY` | https://ai.google.dev/gemini-api/docs |
| Ideogram | `handleIdeogram` (`model === 'ideogram'`) | `IDEOGRAM_API_KEY` | https://docs.ideogram.ai |
| Qwen / DashScope | `handleQwen` (`model === 'qwen-image'`) | `DASHSCOPE_API_KEY`, optional `DASHSCOPE_BASE` | https://dashscope.aliyun.com/api-reference/multimodal/image-generation |
| Runway Gen-4 | `handleRunway` (models `runway-gen4`, `runway-gen4-turbo`) | `RUNWAY_API_KEY` | https://learn.runwayml.com/reference/image-generations |
| BytePlus Ark SeeDream | `handleSeedream` (`model === 'seedream-3.0'`) | `ARK_API_KEY`, optional `ARK_BASE_URL` | https://www.byteplus.com/en/docs/byteplus-ark/api-ref |
| OpenAI Images (DALL·E) | `handleChatGpt` (`model === 'chatgpt-image'`) | `OPENAI_API_KEY` | https://platform.openai.com/docs/api-reference/images |
| Rêve | `handleReve` (`model` prefixed `reve-`) | `REVE_API_KEY`, optional `REVE_BASE_URL` | https://reve.gitbook.io/revepo/api |
| Recraft | `handleRecraft` (`model === 'recraft-v2' | 'recraft-v3'`) | `RECRAFT_API_KEY` | https://docs.recraft.ai/reference |

Below are the highlights we pulled from each set of docs, plus notes on how the Nest service maps requests so you can line things up with the official parameters.

---

## Flux (Black Forest Labs)
- **Endpoint**: `POST {BFL_API_BASE||https://api.bfl.ai}/v1/<model>` with `x-key` header. Poll using the returned `polling_url` (still under `/v1`).
- **Request payload**: `prompt` is mandatory; additional fields (`width`, `height`, `aspect_ratio`, `image_prompt`, `seed`, `raw`, `output_format`, etc.) match the parameters listed in the API reference. The service whitelists keys via `FLUX_OPTION_KEYS`, so anything outside the documented list will be ignored.
- **Response handling**: The API returns `id`, `task_id`, and `polling_url`. We normalise several aliases before polling. The sample/image URL can appear in `result.sample`, `result.samples[*].url`, or `images[*].url` – the extraction logic covers the variants described in the docs.
- **Gotchas**: A `400` from our backend usually means the upstream response lacked an image URL (often because BFL rejected the prompt or timed out). Check the Nest logs for the serialized `createPayload` and `final` entries – we log the upstream JSON before raising the exception so you can see the provider error code.

## Google Gemini (Image Preview)
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=...`
- **Docs**: The preview image endpoint is still in beta; refer to the "Generate images" section in the official Gemini API docs. They require `contents[0].parts[]` with either `text` or `inlineData` entries. We push the main prompt plus any inline reference images as `inlineData`.
- **Quotas**: The docs emphasise rate limits per API key and region – when Gemini returns a `429` or `403`, the backend includes the raw error text in the `details` property of the thrown `HttpException`.

## Ideogram
- **Endpoint**: `POST https://api.ideogram.ai/api/v1/images`
- **Docs**: The GitBook under `docs.ideogram.ai` documents `prompt`, `model`, and optional `aspect_ratio`, `style`, `negative_prompt`, etc. We forward every unknown field from the request body into `providerOptions` so new parameters from the docs propagate without a backend change.
- **Errors**: When the API responds with non-2xx, we log the full response text. The typical causes documented by Ideogram are policy violations or exhausted credits; the API responds with JSON containing an `error` message.

## Qwen (DashScope)
- **Endpoint**: Default base is `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- **Docs**: The DashScope reference describes `input.messages` (chat-style prompts) and `parameters` for image size, seed, negative prompt, etc. Our mapper mirrors the JSON shape from the docs and toggles `prompt_extend` + `watermark` defaults to match examples.
- **Notable fields**: Some doc variants use `size` values like `1024*1024`. Make sure the frontend passes valid `size` strings; invalid combinations cause DashScope to reply with `{ code, message }`, which we bubble up in the `HttpException` body.

## Runway Gen-4
- **Endpoint**: `POST https://api.runwayml.com/v1/image_generations`
- **Docs**: The Runway reference outlines body fields `model`, `prompt`, `ratio`, and `seed`. We automatically map the UI models `runway-gen4` → `gen4_image` and `runway-gen4-turbo` → `gen4_image_turbo` before sending the request.
- **Polling**: Runway responds with a job envelope; the docs recommend polling `/v1/image_generations/{id}` until `status === 'succeeded'`. We currently rely on the single response payload returning an `image_url`. If Runway removes the eager URL, add polling per the docs.

## BytePlus Ark SeeDream
- **Endpoint**: `POST {ARK_BASE_URL||https://ark.ap-southeast.bytepluses.com/api/v3}/image/generate`
- **Docs**: The official Ark reference documents `prompt`, `model` (e.g., `seedream-v3`), and dimension fields. Our handler mirrors the JSON (renaming `num_images` to align with the docs). When the API succeeds, it returns `data.result.images[*].url` as described in the reference.
- **Quotas**: Ark returns error payloads with `code` and `message`. We serialise the entire upstream response into the `HttpException` so you can see those fields in the frontend network panel.

## OpenAI Images (DALL·E)
- **Endpoint**: `POST https://api.openai.com/v1/images/generations`
- **Docs**: The OpenAI Images API reference covers `model`, `prompt`, `size`, `quality`, and `response_format`. We default to `dall-e-3`, `n: 1`, and `size` from `providerOptions`. Responses may contain either `url` or `b64_json`; both code paths are supported per the docs.
- **Errors**: Non-2xx responses include an `error` object. We log the entire payload and raise an `HttpException` with `{ error, details }` so the caller can display the provider message.

## Rêve
- **Endpoint**: `POST {REVE_BASE_URL||https://api.reve.com}/v1/image/create` for generation, `POST .../v1/image/edit` for edits, and `GET .../v1/images/{id}` for polling.
- **Docs**: The GitBook at `reve.gitbook.io/revepo/api` lists `prompt`, `model`, `width`, `height`, `seed`, `guidance_scale`, `steps`, and `negative_prompt`. The backend accepts both snake_case and camelCase versions (mirroring examples from the docs and older SDKs).
- **Assets**: Responses sometimes return direct `data:` URLs or signed URLs in nested arrays (`outputs`, `images`, `result`). We normalise all documented variants before storing the result.

## Recraft
- **Endpoint**: `POST https://external.api.recraft.ai/v1/images/generations`
- **Docs**: The Recraft reference documents `model`, `prompt`, `style`, `substyle`, `size`, `n`, `negative_prompt`, and `controls`. We pass everything from `providerOptions` directly so new parameters added in the docs propagate without a deployment.
- **Responses**: Successful calls return `data.images` with `url` entries. The handler downloads each URL and stores them as data URLs (matching the docs’ note that signed URLs expire quickly).

---

### Troubleshooting `400 Bad Request`
1. **Validate the request body** against the provider docs above. Missing `prompt`/`model` or unsupported enum values are the most common causes – the backend now throws an explicit `400` with an `error` field before talking to the provider in those cases.
2. **Inspect `details` in the response JSON**. Whenever the upstream service returns additional information, we log it server-side and include it in the thrown `HttpException`. Capture the backend logs (`npm run start:dev` prints them) to see the raw provider error.
3. **Confirm API keys and quotas** via the provider dashboards linked above. Many 400/404 responses from the providers are actually auth or quota errors masquerading as generic bad requests.

Keep this document close when rotating keys or expanding provider support so the backend and frontend stay in sync with the officially documented parameters.
