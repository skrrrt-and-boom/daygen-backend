# Manual E2E Testing Guide for Yearly Subscriptions

## Prerequisites
- Backend server running on port 3000
- Frontend server running on port 5173  
- Stripe CLI webhook listener running
- Database connection working

## Test Steps

### 1. Start All Services

**Terminal 1 - Backend:**
```bash
cd /Users/dominiknowak/code/daygen-backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd /Users/dominiknowak/code/daygen0
npm run dev
```

**Terminal 3 - Stripe Webhooks:**
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### 2. Verify Services

- Backend: `curl http://localhost:3000/health` should return `{"status":"ok"}`
- Frontend: Open `http://localhost:5173` in browser
- Stripe CLI: Should show "Ready! Your webhook signing secret is whsec_..."

### 3. Test Pro Yearly Subscription

1. **Navigate to Pricing Page**
   - Go to `http://localhost:5173`
   - Click on "Pricing" or navigate to pricing section

2. **Switch to Yearly Billing**
   - Look for billing period toggle (Monthly/Yearly)
   - Click to switch to "Yearly" billing
   - Verify Pro plan shows "$290 per year" and "12,000 credits per year"

3. **Subscribe to Pro Yearly**
   - Click "Subscribe" on the Pro plan
   - Should redirect to Stripe Checkout
   - Verify the checkout shows yearly billing

4. **Complete Payment**
   - Use test card: `4242 4242 4242 4242`
   - Use any future expiry date (e.g., `12/34`)
   - Use any 3-digit CVC (e.g., `123`)
   - Use any name and email
   - Click "Pay" to complete the payment

5. **Verify Redirect**
   - Should redirect to success page at `http://localhost:5173/payment/success?session_id=cs_test_...`
   - Success page should show payment confirmation

### 4. Monitor Backend Logs

Watch the backend terminal for these log messages:

**During Checkout Creation:**
```
Creating checkout session for user [user-id], type: subscription, package: pro-yearly
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
2025-10-21 10:30:45  --> checkout.session.completed [evt_1234567890]
2025-10-21 10:30:45  <-- [200] POST http://localhost:3000/webhooks/stripe
```

### 6. Verify Database Changes

Check your database for:

**Payment Table:**
- Should have a new record with `status: 'COMPLETED'`
- `type: 'SUBSCRIPTION'`
- `stripeSessionId` matching the checkout session
- `amount: 29000` (for Pro Yearly)
- `credits: 12000` (for Pro Yearly)

**Subscription Table:**
- Should have a new record with `status: 'ACTIVE'`
- `stripeSubscriptionId` from Stripe
- `credits: 12000` (for Pro Yearly)
- `currentPeriodEnd` should be 1 year from now

**User Table:**
- User's `credits` field should be updated with 12,000 credits

### 7. Test Enterprise Yearly Subscription

Repeat steps 3-6 for Enterprise Yearly:
- Should show "$990 per year" and "60,000 credits per year"
- Payment amount should be 99000 cents
- Credits should be 60000

### 8. Test Subscription Management

1. **Check Subscription Status**
   - Navigate to account/profile page
   - Should show active yearly subscription
   - Should show correct billing period (yearly)

2. **Test Cancellation**
   - Use subscription management interface
   - Cancel the subscription
   - Verify it's marked for cancellation at period end

3. **Test Reactivation**
   - Remove cancellation
   - Verify subscription is active again

## Expected Results

### Pro Yearly Subscription
- ✅ Price: $290.00/year
- ✅ Credits: 12,000
- ✅ Plan ID: `pro-yearly`
- ✅ Stripe Price ID: `price_1SKmNLBEB6zYRY4S9TIeDZNo`
- ✅ Billing Period: `year`

### Enterprise Yearly Subscription
- ✅ Price: $990.00/year
- ✅ Credits: 60,000
- ✅ Plan ID: `enterprise-yearly`
- ✅ Stripe Price ID: `price_1SKmNQBEB6zYRY4SMP0LbLN2`
- ✅ Billing Period: `year`

## Troubleshooting

### Database Connection Issues
If you see database timeout errors:
1. Check if Supabase project is active
2. Verify DATABASE_URL in .env file
3. Restart backend server

### Webhook Not Received
If webhooks aren't being received:
1. Ensure Stripe CLI is running
2. Check webhook endpoint URL is correct
3. Verify backend is running on port 3000

### Payment Stuck on Pending
If payment shows as pending:
1. Check webhook processing logs
2. Use manual completion endpoint:
   ```bash
   curl -X POST http://localhost:3000/api/payments/test/complete-payment/[session-id]
   ```

## Manual Test Commands

```bash
# Check backend health
curl http://localhost:3000/health

# Get subscription plans
curl http://localhost:3000/api/payments/subscription-plans

# Complete payment manually (if needed)
curl -X POST http://localhost:3000/api/payments/test/complete-payment/[session-id]
```
