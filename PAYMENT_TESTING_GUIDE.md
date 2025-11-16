# Payment Integration Testing Guide

## Overview
This guide walks you through testing the complete payment integration after implementing the fixes.

## Prerequisites
- [ ] Database configuration updated (see DATABASE_CONFIG_FIX.md)
- [ ] Stripe CLI installed and configured (see STRIPE_CLI_SETUP.md)
- [ ] All environment variables set in `.env` file

## Step-by-Step Testing

### 1. Start All Services

Open three terminal windows:

**Terminal 1 - Backend Server:**
```bash
cd daygen-backend
npm run start:dev
```

**Terminal 2 - Frontend Server:**
```bash
cd daygen0
npm run dev
```

**Terminal 3 - Stripe Webhook Forwarding:**
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### 2. Verify Services Are Running

- Backend: `http://localhost:3000/health` should return `{"status":"ok"}`
- Frontend: `http://localhost:5173` should load the application
- Stripe CLI: Should show "Ready! Your webhook signing secret is whsec_..."

### 3. Test Subscription Purchase

1. **Navigate to Pricing Page**
   - Go to `http://localhost:5173`
   - Click on "Pricing" or navigate to the pricing section

2. **Select a Subscription Plan**
   - Click on "Pro" or "Enterprise" subscription plan
   - This should redirect to Stripe Checkout

3. **Complete Payment**
   - Use test card: `4242 4242 4242 4242`
   - Use any future expiry date (e.g., `12/34`)
   - Use any 3-digit CVC (e.g., `123`)
   - Use any name and email
   - Click "Pay" to complete the payment

4. **Verify Redirect**
   - Should redirect to success page at `http://localhost:5173/payment/success?session_id=cs_test_...`
   - Success page should show payment confirmation

### 4. Monitor Backend Logs

Watch the backend terminal for these log messages:

**During Checkout Creation:**
```
Creating checkout session for user [user-id], type: subscription, package: pro
Created checkout session [session-id] for user [user-id]
Created pending payment record for subscription session [session-id] for user [user-id]
```

**During Webhook Processing:**
```
Webhook received - checking signature
Received webhook event: checkout.session.completed (ID: evt_1234567890)
Processing checkout session completed: [session-id]
Processing subscription for session [session-id]
Retrieving subscription [subscription-id] from Stripe
Retrieved subscription: [subscription-id], status: active
Successfully processed subscription [subscription-id]
```

### 5. Monitor Stripe CLI Logs

Watch the Stripe CLI terminal for webhook events:
```
2024-01-15 10:30:45  --> checkout.session.completed [evt_1234567890]
2024-01-15 10:30:45  <-- [200] POST http://localhost:3000/webhooks/stripe
```

### 6. Verify Database Changes

Check your Supabase database for:

**Payment Table:**
- Should have a new record with `status: 'COMPLETED'`
- `type: 'SUBSCRIPTION'`
- `stripeSessionId` matching the checkout session

**Subscription Table:**
- Should have a new record with `status: 'ACTIVE'`
- `stripeSubscriptionId` from Stripe
- `credits` matching the plan (NOT 0) ✅ **Critical**: Verify credits > 0

**User Table:**
- User's `credits` field should be updated with the subscription credits

### 7. Verify Frontend Updates

1. **Check User Profile**
   - Navigate to account/profile page
   - Should show updated credit balance
   - Should show active subscription information

2. **Test Credit Usage**
   - Try generating an image
   - Credits should be deducted from the new balance

## Troubleshooting

### Payment Stuck on "Pending"
**Symptoms:** Payment success page shows "Payment is still pending"

**Causes:**
- Webhook not received
- Webhook processing failed
- Database connection issues

**Solutions:**
1. Check Stripe CLI is running and receiving events
2. Check backend logs for webhook processing errors
3. Verify database connection (check for P1017/P2024 errors)
4. Use the manual complete button on the success page (development only)

### Database Connection Errors
**Symptoms:** P1017 or P2024 Prisma errors

**Solutions:**
1. Update `.env` with Supabase connection pooler settings
2. Restart backend server
3. Check Supabase project is active

### Webhook Not Received
**Symptoms:** No webhook events in Stripe CLI

**Solutions:**
1. Ensure `stripe listen` is running
2. Check webhook endpoint URL is correct
3. Verify backend is running on port 3000
4. Check firewall/network settings

### Credits Not Added
**Symptoms:** Payment completed but credits not updated

**Solutions:**
1. Check webhook processed `checkout.session.completed` event
2. Verify subscription record was created
3. Check `addCreditsToUser` function executed successfully
4. Look for errors in backend logs

### Subscription Has 0 Credits
**Symptoms:** Subscription record created but `credits` field is 0 in database

**Root Causes:**
- Plan lookup failed (Plan table not accessible or priceId doesn't match)
- Environment variables for Stripe price IDs not set correctly
- Price ID from Stripe doesn't map to any plan in code config

**Solutions:**
1. Check backend logs for plan resolution:
   - Look for "💰 Resolved plan credits for priceId..." (success)
   - Look for "⚠️ Could not resolve plan for priceId..." (failure)
2. Verify Plan table exists and has correct priceId mappings:
   ```sql
   SELECT * FROM "Plan" WHERE "stripePriceId" = '<price_id_from_stripe>';
   ```
3. Check environment variables match Stripe price IDs:
   - `STRIPE_PRO_PRICE_ID`
   - `STRIPE_ENTERPRISE_PRICE_ID`
   - `STRIPE_PRO_YEARLY_PRICE_ID`
   - `STRIPE_ENTERPRISE_YEARLY_PRICE_ID`
4. Verify priceId from subscription matches one in Plan table or code config
5. Check if safety fallback activated: Look for "⚠️ Subscription created with 0 credits, attempting to resolve..."
6. If still 0, manually update subscription credits based on plan

## Success Criteria

✅ **Payment Flow Complete:**
- [ ] Checkout session created successfully
- [ ] Payment completed in Stripe
- [ ] Redirected to success page
- [ ] Webhook received and processed
- [ ] Payment record created in database
- [ ] Subscription record created in database with correct credits (not 0) ⚠️
- [ ] User credits updated
- [ ] Frontend shows updated balance

✅ **No Errors:**
- [ ] No database connection timeouts
- [ ] No webhook signature verification failures
- [ ] No missing payment records
- [ ] No duplicate credit additions

## Next Steps

Once testing is successful:
1. Test with different subscription plans
2. Test subscription cancellation
3. Test subscription upgrades/downgrades
4. Test one-time credit purchases
5. Prepare for production deployment

## Manual Testing Commands

If you need to manually complete a payment for testing:

```bash
# Complete payment by session ID
curl -X POST http://localhost:3000/api/payments/test/complete-payment/[session-id]

# Complete payment by payment intent ID
curl -X POST http://localhost:3000/api/payments/test/complete-by-intent/[payment-intent-id]
```
