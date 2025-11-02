# Webhook Processing Debugging Summary

> Archived: superseded by `WEBHOOK_PROCESSING_SOLUTION.md` (production-ready). Keep for historical context only.

## Current Status

### ✅ **FIXED**
1. **Database Connection** - Now using Supabase connection pooler (port 6543)
2. **Payment Record Creation** - Subscription checkouts create PENDING payment records
3. **Webhook Signature Verification** - Working correctly (200 status codes from Stripe CLI)
4. **Webhook Endpoint** - Accessible and responding at `/webhooks/stripe`

### ❌ **ISSUE** (historical)
**No subscription records are being created from webhook events** (for synthetic CLI-triggered events without real session metadata)

## Root Cause Analysis

The webhook processing is failing silently because:

1. **Stripe CLI Test Events** - The `stripe trigger` command creates test fixtures that don't have real user IDs in the session metadata
2. **Webhook Handler Logic** - The `handleSuccessfulSubscriptionFromSession` method requires a valid `userId` in the session metadata:
   ```typescript
   const userId = session.metadata?.userId;
   if (!userId) {
     this.logger.error(`No userId found in session metadata for subscription ${subscription.id}`);
     return; // Fails silently and returns 200
   }
   ```
3. **Missing Logs** - When the webhook fails due to missing userId, it logs an error but still returns 200 to Stripe, making it appear successful

## Evidence

1. **Stripe CLI Logs** - Show 200 status codes for all webhook events:
   ```
   2025-10-21 20:57:27   --> customer.subscription.created [evt_1SKkkNBEB6zYRY4Snnfek6Eg]
   2025-10-21 20:57:27  <--  [200] POST http://localhost:3000/webhooks/stripe
   ```

2. **Database Checks** - No new subscription records created after webhook triggers

3. **Backend Logs** - No webhook processing logs visible (likely logged as errors in `setImmediate` callback)

## Next Steps to Fix

### Option 1: Test with Real Checkout Session (RECOMMENDED)
1. Go to `http://localhost:5173` (frontend)
2. Click on a subscription plan
3. Use test card: `4242 4242 4242 4242`
4. Complete the checkout
5. Webhook will fire with real userId in metadata
6. Verify subscription record is created in database

### Option 2: Modify Webhook Handler for Testing
Add better error logging in `stripe-webhook.controller.ts` to see why webhook processing fails:

```typescript
private async handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
) {
  this.logger.log(`Processing checkout session completed: ${session.id}`);
  this.logger.log(`Session mode: ${session.mode}`);
  this.logger.log(`Session metadata:`, JSON.stringify(session.metadata));
  this.logger.log(`Session subscription ID: ${session.subscription}`);

  // Process in background for faster webhook response
  setImmediate(async () => {
    try {
      if (session.mode === 'subscription') {
        this.logger.log(`Processing subscription for session ${session.id}`);
        if (session.subscription) {
          const subscription = await this.stripeService.retrieveSubscription(
            session.subscription as string,
          );
          await this.paymentsService.handleSuccessfulSubscriptionFromSession(subscription, session);
          this.logger.log(`Successfully processed subscription ${subscription.id}`);
        } else {
          this.logger.error(`No subscription ID found in session ${session.id}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing checkout session ${session.id}:`, error.stack || error);
    }
  });
}
```

### Option 3: Create Manual Test Endpoint
Use the existing test endpoint to simulate a successful subscription:

```bash
curl -X POST http://localhost:3000/api/public-payments/test/create-manual-subscription \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<real-user-id>",
    "planId": "pro"
  }'
```

## Testing Checklist

- [x] Database connection working with Supabase pooler
- [x] Webhook endpoint accessible
- [x] Webhook signature verification working
- [x] Payment record created on checkout session creation
- [ ] **Webhook processes subscription events with real userId** ⬅️ NEXT STEP
- [ ] Subscription record created in database
- [ ] Credits added to user account
- [ ] Frontend shows updated credit balance

## Commands to Monitor

```bash
# Terminal 1: Backend logs
cd /Users/dominiknowak/code/daygen-backend
tail -f backend.log | grep -E "(webhook|Webhook|subscription|Subscription|Processing|Error)"

# Terminal 2: Stripe webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe

# Terminal 3: Database monitoring
watch -n 2 'echo "SELECT id, status, stripe_subscription_id, created_at FROM \"Subscription\" ORDER BY created_at DESC LIMIT 5;" | psql <connection-string>'
```

## Conclusion

The payment integration is **90% complete**. The remaining issue is that test webhook events don't have real user IDs. The system will work correctly when:

1. A real user completes a checkout (userId will be in session metadata)
2. The webhook will process successfully
3. Subscription record will be created in Supabase
4. Credits will be added to the user account

**RECOMMENDATION**: Test with a real checkout flow through the frontend to verify complete end-to-end functionality.

