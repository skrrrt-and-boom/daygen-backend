# Stripe CLI Setup for Local Development

## Problem
Stripe webhooks cannot reach `localhost:3000` in your local development environment, causing payments to be processed in Stripe but not reflected in your database.

## Solution
Use Stripe CLI to forward webhook events from Stripe to your local development server.

## Installation

### macOS (using Homebrew)
```bash
brew install stripe/stripe-cli/stripe
```

### Other Platforms
Download from: https://stripe.com/docs/stripe-cli

## Setup Steps

### 1. Login to Stripe
```bash
stripe login
```
This will open a browser window to authenticate with your Stripe account.

### 2. Forward Webhooks to Local Server
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

**Important:** Keep this command running in a separate terminal while testing payments.

### 3. Copy Webhook Secret
When you run the `stripe listen` command, you'll see output like:
```
> Ready! Your webhook signing secret is whsec_1234567890abcdef...
```

Copy the webhook signing secret (starts with `whsec_`) and add it to your `.env` file:
```env
STRIPE_WEBHOOK_SECRET="whsec_1234567890abcdef..."
```

### 4. Verify Webhook Events
The Stripe CLI will show webhook events as they're received:
```
2024-01-15 10:30:45  --> checkout.session.completed [evt_1234567890]
2024-01-15 10:30:45  <-- [200] POST http://localhost:3000/webhooks/stripe
```

## Testing the Complete Flow

### 1. Start All Services
Open three terminals:

**Terminal 1 - Backend:**
```bash
cd daygen-backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd daygen0
npm run dev
```

**Terminal 3 - Stripe Webhooks:**
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### 2. Test a Subscription Purchase
1. Go to `http://localhost:5173`
2. Click on a subscription plan (Pro or Enterprise)
3. Use test card: `4242 4242 4242 4242`
4. Complete the checkout
5. Should redirect to success page
6. Webhook should fire automatically via Stripe CLI
7. Credits should be added to your account

### 3. Verify in Logs
Look for these log messages in your backend:

**When creating checkout session:**
```
Creating checkout session for user [user-id], type: subscription, package: pro
Created checkout session [session-id] for user [user-id]
Created pending payment record for subscription session [session-id] for user [user-id]
```

**When webhook is received:**
```
Webhook received - checking signature
Received webhook event: checkout.session.completed (ID: evt_1234567890)
Processing checkout session completed: [session-id]
Processing subscription for session [session-id]
Successfully processed subscription [subscription-id]
```

## Troubleshooting

### Webhook Not Receiving Events
1. Ensure `stripe listen` is running
2. Check that the webhook endpoint URL is correct: `localhost:3000/webhooks/stripe`
3. Verify your backend is running on port 3000

### Webhook Signature Verification Fails
1. Ensure `STRIPE_WEBHOOK_SECRET` in your `.env` matches the one from `stripe listen`
2. Restart your backend after updating the webhook secret

### Payment Record Not Found
1. Check that the Payment record was created during checkout (should see log message)
2. Verify the database connection is working
3. Check that the webhook is processing the `checkout.session.completed` event

### Database Connection Errors
1. Update your `.env` file with the Supabase connection pooler settings (see DATABASE_CONFIG_FIX.md)
2. Restart your backend server

## Alternative: Using ngrok

If you prefer not to use Stripe CLI, you can use ngrok to expose your local server:

1. Install ngrok: `brew install ngrok`
2. Expose local server: `ngrok http 3000`
3. Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)
4. Update your Stripe webhook endpoint to use the ngrok URL
5. Use the webhook secret from your Stripe Dashboard

However, Stripe CLI is recommended as it's simpler and doesn't require changing webhook configurations.
