# Stripe Payment Integration Setup Guide

This guide will help you set up Stripe payments for the DayGen platform.

## 1. Stripe Dashboard Setup

### Create Stripe Account
1. Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Create your Stripe account
3. Complete the account verification process

### Get API Keys
1. In the Stripe Dashboard, go to **Developers** > **API keys**
2. Copy your **Publishable key** (starts with `pk_test_` for test mode)
3. Copy your **Secret key** (starts with `sk_test_` for test mode)
4. Keep these keys secure - never commit them to version control

### Create Products and Prices

#### Credit Packages (One-time purchases)
1. Go to **Products** in the Stripe Dashboard
2. Click **Add product**
3. Create the following products:

**Test Pack (for testing)**
- Product name: `Test Pack`
- Description: `10 credits for testing purposes`
- Pricing model: `One-time`
- Price: `$0.01` (1 cent)
- Save the Price ID (starts with `price_`)

**Starter Pack**
- Product name: `Starter Pack`
- Description: `100 credits for getting started`
- Pricing model: `One-time`
- Price: `$10.00`
- Save the Price ID

**Popular Pack**
- Product name: `Popular Pack`
- Description: `500 credits - most popular choice`
- Pricing model: `One-time`
- Price: `$40.00`
- Save the Price ID

**Best Value Pack**
- Product name: `Best Value Pack`
- Description: `1000 credits - best value`
- Pricing model: `One-time`
- Price: `$70.00`
- Save the Price ID

#### Subscription Plans
1. Create subscription products:

**Pro Subscription**
- Product name: `Pro Subscription`
- Description: `Monthly subscription with 1000 credits`
- Pricing model: `Recurring`
- Price: `$29.00`
- Billing period: `Monthly`
- Save the Price ID

**Enterprise Subscription**
- Product name: `Enterprise Subscription`
- Description: `Monthly subscription with 5000 credits`
- Pricing model: `Recurring`
- Price: `$99.00`
- Billing period: `Monthly`
- Save the Price ID

### Configure Webhook
1. Go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL: `https://your-domain.com/webhooks/stripe`
   - For local development: `https://your-ngrok-url.ngrok.io/webhooks/stripe`
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

## 2. Environment Variables

### Backend (.env)
Add these variables to your backend `.env` file:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Frontend URL (for redirects)
FRONTEND_URL=http://localhost:5173

# Price IDs (replace with actual IDs from Stripe Dashboard)
STRIPE_TEST_PRICE_ID=price_test_10_credits
STRIPE_STARTER_PRICE_ID=price_starter_100_credits
STRIPE_POPULAR_PRICE_ID=price_popular_500_credits
STRIPE_BEST_VALUE_PRICE_ID=price_best_value_1000_credits
STRIPE_PRO_PRICE_ID=price_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_enterprise_monthly
```

### Frontend (.env)
Add this variable to your frontend `.env` file:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

## 3. Update Price ID Configuration

Update the price ID mapping in `src/payments/payments.service.ts`:

```typescript
private getPriceIdForPackage(creditPackage: any): string {
  const priceIdMap: Record<string, string> = {
    'test': process.env.STRIPE_TEST_PRICE_ID || 'price_test_10_credits',
    'starter': process.env.STRIPE_STARTER_PRICE_ID || 'price_starter_100_credits',
    'popular': process.env.STRIPE_POPULAR_PRICE_ID || 'price_popular_500_credits',
    'best-value': process.env.STRIPE_BEST_VALUE_PRICE_ID || 'price_best_value_1000_credits',
  };
  
  return priceIdMap[creditPackage.id] || 'price_test_10_credits';
}

private getPriceIdForSubscription(plan: any): string {
  const priceIdMap: Record<string, string> = {
    'pro': process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
    'enterprise': process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
  };
  
  return priceIdMap[plan.id] || 'price_pro_monthly';
}
```

## 4. Testing

### Test Cards
Use these test card numbers in Stripe test mode:

- **Successful payment**: `4242 4242 4242 4242`
- **Declined payment**: `4000 0000 0000 0002`
- **Requires authentication**: `4000 0025 0000 3155`

### Test Flow
1. Start your backend server: `npm run start:dev`
2. Start your frontend: `npm run dev`
3. Go to `/upgrade` page
4. Try purchasing credits with test card
5. Check webhook events in Stripe Dashboard
6. Verify credits are added to user account

### Webhook Testing (Local Development)
1. Install Stripe CLI: `stripe login`
2. Forward webhooks: `stripe listen --forward-to localhost:3000/webhooks/stripe`
3. Use the webhook signing secret from the CLI output

## 5. Production Deployment

### Switch to Live Mode
1. In Stripe Dashboard, toggle **Test mode** off
2. Get live API keys from **Developers** > **API keys**
3. Update environment variables with live keys
4. Update webhook endpoint URL to production domain
5. Test with real payment methods (small amounts)

### Security Checklist
- [ ] Never commit API keys to version control
- [ ] Use environment variables for all sensitive data
- [ ] Verify webhook signatures
- [ ] Use HTTPS in production
- [ ] Monitor webhook events and errors
- [ ] Set up proper error handling and logging

## 6. Monitoring and Maintenance

### Stripe Dashboard
- Monitor payments in **Payments** section
- Check webhook events in **Developers** > **Webhooks**
- Review failed payments and disputes

### Application Logs
- Monitor payment processing logs
- Track webhook event handling
- Watch for failed credit additions

### Common Issues
1. **Webhook signature verification fails**: Check webhook secret
2. **Credits not added**: Verify webhook event handling
3. **Payment not completing**: Check success/cancel URLs
4. **CORS errors**: Verify allowed origins in Stripe settings

## 7. Support

- Stripe Documentation: [https://stripe.com/docs](https://stripe.com/docs)
- Stripe Support: Available in Stripe Dashboard
- Test webhook events: Use Stripe CLI or Dashboard test mode
