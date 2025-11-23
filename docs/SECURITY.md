# Security & Logging Hygiene

## Required Environment Variables
The application enforces the presence of the following environment variables at startup. If any are missing, the application will fail to start.

- `DATABASE_URL`: Connection string for the database.
- `JWT_SECRET`: Secret key for signing JWTs.
- `R2_ACCESS_KEY_ID`: Cloudflare R2 access key ID.
- `R2_SECRET_ACCESS_KEY`: Cloudflare R2 secret access key.
- `R2_BUCKET_NAME`: Cloudflare R2 bucket name.
- `R2_ACCOUNT_ID`: Cloudflare R2 account ID.

## Logging Policy
- **Redaction**: Sensitive information (e.g., `authorization`, `cookie`, `password`, `apiKey`, `token`) is redacted from logs.
- **Prompt Truncation**: Prompts in error logs are truncated to 100 characters to prevent leaking sensitive user input or overwhelming logs.

## HTTP Security
- **Timeouts**: All external HTTP requests have a default timeout (default: 30s) to prevent hanging connections.
- **URL Validation**: URLs are validated to ensure they use `http:` or `https:` protocols.
