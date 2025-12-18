# Stripe Production Launch Checklist

Complete guide for switching from Stripe **test mode** to **live mode**.

## Prerequisites

Before switching to production:
- [ ] All payment flows tested in test mode
- [ ] Webhook processing verified working
- [ ] Database migrations applied
- [ ] Backend deployed to production URL

---

## Step 1: Create Live Mode Products in Stripe

Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Products** (ensure "Test mode" toggle is OFF).

### Subscriptions (6 products)

| Product Name | Price | Billing | Credits |
|-------------|-------|---------|---------|
| Starter Monthly | $39.00/month | Recurring | 200 |
| Pro Monthly | $99.00/month | Recurring | 1,000 |
| Agency Monthly | $299.00/month | Recurring | 4,000 |
| Starter Yearly | $374.40/year | Recurring | 2,400 |
| Pro Yearly | $950.40/year | Recurring | 12,000 |
| Agency Yearly | $2,870.40/year | Recurring | 48,000 |

### Top-Up Packages (3 products)

| Product Name | Price | Type | Credits |
|-------------|-------|------|---------|
| Starter Top-Up | $19.00 | One-time | 100 |
| Pro Top-Up | $79.00 | One-time | 500 |
| Agency Top-Up | $249.00 | One-time | 2,000 |

> [!TIP]
> Copy the `price_...` ID for each product after creation.

---

## Step 2: Create Live Webhook Endpoint

1. Go to **Developers** → **Webhooks** → **Add endpoint**
2. Set endpoint URL: `https://YOUR_PRODUCTION_URL/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`)

---

## Step 3: Update Environment Variables

Replace ALL test values with live values:

```env
# API Keys (from Developers → API keys)
STRIPE_SECRET_KEY=sk_live_...          # Was: sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_live_...     # Was: pk_test_...

# Webhook Secret (from Webhooks → endpoint → Signing secret)
STRIPE_WEBHOOK_SECRET=whsec_...        # New live secret

# Monthly Subscriptions
STRIPE_STARTER_PRICE_ID=price_...      # Live Starter Monthly price ID
STRIPE_PRO_PRICE_ID=price_...          # Live Pro Monthly price ID
STRIPE_AGENCY_PRICE_ID=price_...       # Live Agency Monthly price ID

# Yearly Subscriptions
STRIPE_STARTER_YEARLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_AGENCY_YEARLY_PRICE_ID=price_...

# Top-Ups
STRIPE_STARTER_TOPUP_PRICE_ID=price_...
STRIPE_PRO_TOPUP_PRICE_ID=price_...
STRIPE_AGENCY_TOPUP_PRICE_ID=price_...
```

---

## Step 4: Deploy and Verify

### Pre-Deploy Checklist
- [ ] All 12 environment variables updated
- [ ] Production URL accessible
- [ ] Database connection working

### Deploy
```bash
# Deploy to production (adjust for your deployment method)
gcloud run deploy daygen-backend --source .
```

### Post-Deploy Verification
- [ ] Health check: `curl https://YOUR_URL/health`
- [ ] Webhook test: Use Stripe Dashboard → Webhooks → Send test webhook
- [ ] Check logs for successful webhook processing

---

## Step 5: Test with Real Payment (Recommended)

Before announcing:
1. Purchase cheapest subscription (Starter $39)
2. Verify:
   - [ ] Checkout completes
   - [ ] Webhook received (check logs)
   - [ ] Credits added to account
   - [ ] Subscription shows in database
3. Cancel via Customer Portal
4. Request refund in Stripe Dashboard

---

## Rollback Procedure

If issues arise, revert to test mode:

1. Update environment variables back to `sk_test_...` values
2. Redeploy
3. Investigate issue in test mode

> [!CAUTION]
> Live payments already processed cannot be undone via rollback. Handle refunds manually in Stripe Dashboard.

---

## Quick Reference

| Item | Test Mode | Live Mode |
|------|-----------|-----------|
| Secret Key | `sk_test_...` | `sk_live_...` |
| Publishable Key | `pk_test_...` | `pk_live_...` |
| Test Card | 4242 4242 4242 4242 | Real cards only |
| Webhook URL | localhost via Stripe CLI | Production URL |
