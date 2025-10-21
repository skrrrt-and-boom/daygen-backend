# Stripe Payment Integration Setup Guide

This comprehensive guide will help you set up Stripe payments for the DayGen platform from account creation to production deployment.

## Table of Contents
1. [Stripe Account Setup](#1-stripe-account-setup)
2. [API Keys Configuration](#2-api-keys-configuration)
3. [Product and Price Creation](#3-product-and-price-creation)
4. [Webhook Configuration](#4-webhook-configuration)
5. [Environment Variables](#5-environment-variables)
6. [Local Testing](#6-local-testing)
7. [Production Deployment](#7-production-deployment)
8. [Troubleshooting](#8-troubleshooting)

## 1. Stripe Account Setup

### Step 1: Create Stripe Account
1. **Visit Stripe Registration**: Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. **Enter Business Information**:
   - Email address (use a business email if possible)
   - Full name
   - Country/region
   - Business type (Individual, Company, Non-profit, etc.)
3. **Verify Email**: Check your email and click the verification link
4. **Complete Profile**: Fill in additional business details (can be updated later)

### Step 2: Account Verification (Optional for Test Mode)
For test mode, you can skip verification. For production, you'll need:
- Business registration documents
- Bank account information
- Tax identification number
- Identity verification

### Step 3: Enable Test Mode
1. In the Stripe Dashboard, ensure **Test mode** is enabled (toggle in top-left)
2. You'll see "Test mode" indicator in the dashboard header

## 2. API Keys Configuration

### Step 1: Get API Keys
1. **Navigate to API Keys**: In Stripe Dashboard, go to **Developers** → **API keys**
2. **Copy Keys**:
   - **Publishable key**: Starts with `pk_test_` (for test mode)
   - **Secret key**: Starts with `sk_test_` (for test mode)
3. **Security Note**: Never commit these keys to version control

### Step 2: Key Usage
- **Publishable Key**: Used in frontend (safe to expose in client code)
- **Secret Key**: Used in backend only (keep private)
- **Webhook Secret**: Obtained after creating webhook endpoint (see section 4)

## 3. Product and Price Creation

### Step 1: Navigate to Products
1. In Stripe Dashboard, go to **Products** in the left sidebar
2. Click **Add product** button

### Step 2: Create One-Time Credit Packages

#### Test Pack (for testing)
1. **Product Information**:
   - Product name: `Test Pack`
   - Description: `10 credits for testing purposes`
2. **Pricing**:
   - Pricing model: `One-time`
   - Price: `$0.01` (1 cent)
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID (starts with `price_`)

#### Starter Pack
1. **Product Information**:
   - Product name: `Starter Pack`
   - Description: `100 credits for getting started`
2. **Pricing**:
   - Pricing model: `One-time`
   - Price: `$10.00`
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID

#### Popular Pack
1. **Product Information**:
   - Product name: `Popular Pack`
   - Description: `500 credits - most popular choice`
2. **Pricing**:
   - Pricing model: `One-time`
   - Price: `$40.00`
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID

#### Best Value Pack
1. **Product Information**:
   - Product name: `Best Value Pack`
   - Description: `1000 credits - best value`
2. **Pricing**:
   - Pricing model: `One-time`
   - Price: `$70.00`
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID

### Step 3: Create Subscription Plans

#### Pro Subscription
1. **Product Information**:
   - Product name: `Pro Subscription`
   - Description: `Monthly subscription with 1000 credits`
2. **Pricing**:
   - Pricing model: `Recurring`
   - Price: `$29.00`
   - Billing period: `Monthly`
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID

#### Enterprise Subscription
1. **Product Information**:
   - Product name: `Enterprise Subscription`
   - Description: `Monthly subscription with 5000 credits`
2. **Pricing**:
   - Pricing model: `Recurring`
   - Price: `$99.00`
   - Billing period: `Monthly`
   - Currency: USD
3. **Save**: Click **Save product**
4. **Copy Price ID**: Copy the Price ID

### Step 4: Record Price IDs
Create a temporary note with all Price IDs:
```
Test Pack: price_xxxxx
Starter Pack: price_xxxxx
Popular Pack: price_xxxxx
Best Value Pack: price_xxxxx
Pro Subscription: price_xxxxx
Enterprise Subscription: price_xxxxx
```

## 4. Webhook Configuration

### Step 1: Navigate to Webhooks
1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click **Add endpoint**

### Step 2: Configure Endpoint
1. **Endpoint URL**:
   - For production: `https://your-domain.com/webhooks/stripe`
   - For local development: `https://your-ngrok-url.ngrok.io/webhooks/stripe`
2. **Description**: `DayGen Payment Webhooks`

### Step 3: Select Events
Select the following events to listen for:
- `checkout.session.completed` - One-time payments completed
- `customer.subscription.created` - New subscription created
- `customer.subscription.updated` - Subscription status changed
- `customer.subscription.deleted` - Subscription cancelled
- `invoice.payment_succeeded` - Recurring payment successful
- `invoice.payment_failed` - Recurring payment failed

### Step 4: Create Endpoint
1. Click **Add endpoint**
2. **Copy Signing Secret**: Copy the webhook signing secret (starts with `whsec_`)
3. **Test Endpoint**: Click **Send test webhook** to verify it's working

### Step 5: Local Development Setup
For local testing, you'll need to expose your local server:
1. **Install ngrok**: `npm install -g ngrok` or download from [ngrok.com](https://ngrok.com)
2. **Start your backend**: `npm run start:dev`
3. **Expose local server**: `ngrok http 3000`
4. **Update webhook URL**: Use the ngrok URL in Stripe Dashboard
5. **Alternative - Stripe CLI**: `stripe listen --forward-to localhost:3000/webhooks/stripe`

## 5. Environment Variables

### Step 1: Backend Configuration
Create a `.env` file in your backend root directory with the following variables:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Frontend URL (for payment redirects)
FRONTEND_URL=http://localhost:5173

# Price IDs (replace with actual IDs from Stripe Dashboard)
STRIPE_TEST_PRICE_ID=price_xxxxx
STRIPE_STARTER_PRICE_ID=price_xxxxx
STRIPE_POPULAR_PRICE_ID=price_xxxxx
STRIPE_BEST_VALUE_PRICE_ID=price_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx
```

### Step 2: Frontend Configuration
Create a `.env` file in your frontend root directory:

```env
# Stripe Configuration
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here

# API Configuration
VITE_API_URL=http://localhost:3000/api
```

### Step 3: Verify Configuration
1. **Backend**: Restart your backend server after adding environment variables
2. **Frontend**: Restart your frontend development server
3. **Check Logs**: Look for any configuration errors in the console

## 6. Local Testing

### Step 1: Test Card Numbers
Use these test card numbers in Stripe test mode:

| Card Number | Description | Expected Result |
|-------------|-------------|-----------------|
| `4242 4242 4242 4242` | Visa | Successful payment |
| `4000 0000 0000 0002` | Visa | Declined payment |
| `4000 0025 0000 3155` | Visa | Requires authentication |
| `5555 5555 5555 4444` | Mastercard | Successful payment |
| `2223 0031 2200 3222` | Mastercard | Successful payment |

### Step 2: Test Flow
1. **Start Backend**: `npm run start:dev` (in backend directory)
2. **Start Frontend**: `npm run dev` (in frontend directory)
3. **Navigate to Payment Page**: Go to `/upgrade` or payment page
4. **Test One-Time Purchase**:
   - Select a credit package
   - Use test card `4242 4242 4242 4242`
   - Complete payment flow
   - Verify credits added to account
5. **Test Subscription**:
   - Select a subscription plan
   - Use test card `4242 4242 4242 4242`
   - Complete subscription flow
   - Verify subscription created

### Step 3: Webhook Testing
1. **Install Stripe CLI**: `npm install -g @stripe/stripe-cli`
2. **Login to Stripe**: `stripe login`
3. **Forward Webhooks**: `stripe listen --forward-to localhost:3000/webhooks/stripe`
4. **Copy Webhook Secret**: Use the signing secret from CLI output
5. **Test Webhook Events**: Make test payments and verify webhook events are received

### Step 4: Verify Integration
1. **Check Payment History**: Verify payments appear in user's payment history
2. **Check Credits**: Verify credits are added to user account
3. **Check Webhook Logs**: Monitor backend logs for webhook processing
4. **Check Stripe Dashboard**: Verify events appear in Stripe Dashboard

## 7. Production Deployment

### Step 1: Complete Stripe Account Verification
1. **Switch to Live Mode**: In Stripe Dashboard, toggle **Test mode** off
2. **Complete Verification**: Provide required business documents
3. **Add Bank Account**: Add your business bank account for payouts
4. **Tax Information**: Complete tax information if required

### Step 2: Update Configuration
1. **Get Live API Keys**: From **Developers** → **API keys** (live mode)
2. **Update Environment Variables**: Replace test keys with live keys
3. **Update Webhook URL**: Change to production domain
4. **Test with Small Amounts**: Use real payment methods with small amounts

### Step 3: Security Checklist
- [ ] Never commit API keys to version control
- [ ] Use environment variables for all sensitive data
- [ ] Verify webhook signatures
- [ ] Use HTTPS in production
- [ ] Monitor webhook events and errors
- [ ] Set up proper error handling and logging
- [ ] Enable Stripe Radar for fraud detection
- [ ] Set up webhook retry policies

## 8. Related Documentation

- [Webhook Processing Solution](WEBHOOK_PROCESSING_SOLUTION.md) - Detailed webhook implementation
- [Payment Testing Guide](PAYMENT_TESTING_GUIDE.md) - Testing procedures
- [Production Deployment](docs/PRODUCTION_DEPLOYMENT.md) - Deployment instructions

## 9. Troubleshooting

### Common Issues

#### Webhook Signature Verification Fails
**Error**: `Webhook signature verification failed`
**Solution**: 
1. Check webhook secret in environment variables
2. Ensure webhook endpoint uses raw body parser
3. Verify webhook URL is correct

#### Credits Not Added After Payment
**Error**: Payment successful but credits not added
**Solution**:
1. Check webhook events in Stripe Dashboard
2. Verify webhook endpoint is receiving events
3. Check backend logs for webhook processing errors
4. Ensure user exists in database

#### Payment Not Completing
**Error**: Payment flow doesn't complete
**Solution**:
1. Check success/cancel URLs in Stripe configuration
2. Verify CORS settings allow your domain
3. Check frontend console for JavaScript errors
4. Verify Stripe publishable key is correct

#### CORS Errors
**Error**: CORS policy blocks Stripe requests
**Solution**:
1. Add your domain to Stripe allowed origins
2. Check backend CORS configuration
3. Verify frontend URL matches backend CORS settings

### Debugging Tools

#### Stripe Dashboard
- **Payments**: Monitor payment status and errors
- **Webhooks**: Check webhook delivery status
- **Logs**: View detailed API request logs
- **Events**: Monitor all Stripe events

#### Application Logs
- **Backend Logs**: Check payment processing logs
- **Webhook Logs**: Monitor webhook event handling
- **Error Logs**: Track failed operations

#### Stripe CLI
```bash
# Monitor webhook events
stripe listen --forward-to localhost:3000/webhooks/stripe

# Test webhook events
stripe trigger checkout.session.completed

# View logs
stripe logs tail
```

### Support Resources
- **Stripe Documentation**: [https://stripe.com/docs](https://stripe.com/docs)
- **Stripe Support**: Available in Stripe Dashboard
- **Stripe Community**: [https://github.com/stripe/stripe-node](https://github.com/stripe/stripe-node)
- **Test Webhook Events**: Use Stripe CLI or Dashboard test mode
