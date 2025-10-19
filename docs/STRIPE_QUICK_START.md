# Stripe Quick Start Guide

Quick setup checklist for developers familiar with Stripe.

## Prerequisites
- Stripe account (create at [dashboard.stripe.com](https://dashboard.stripe.com))
- Backend and frontend applications running

## Setup Checklist

### 1. Stripe Dashboard Setup
- [ ] Create Stripe account
- [ ] Enable test mode
- [ ] Get API keys (Developers → API keys)
- [ ] Create 6 products with prices (see product list below)
- [ ] Create webhook endpoint
- [ ] Copy webhook signing secret

### 2. Environment Variables
- [ ] Backend `.env` configured
- [ ] Frontend `.env` configured
- [ ] All Price IDs added
- [ ] Webhook secret added

### 3. Testing
- [ ] Backend server running
- [ ] Frontend server running
- [ ] Test payment with `4242 4242 4242 4242`
- [ ] Verify credits added
- [ ] Check webhook events

## Required Products

### One-Time Purchases
| Product | Price | Credits | Price ID Variable |
|---------|-------|---------|-------------------|
| Test Pack | $0.01 | 10 | `STRIPE_TEST_PRICE_ID` |
| Starter Pack | $10.00 | 100 | `STRIPE_STARTER_PRICE_ID` |
| Popular Pack | $40.00 | 500 | `STRIPE_POPULAR_PRICE_ID` |
| Best Value Pack | $70.00 | 1000 | `STRIPE_BEST_VALUE_PRICE_ID` |

### Subscriptions
| Product | Price | Credits | Price ID Variable |
|---------|-------|---------|-------------------|
| Pro Subscription | $29.00/month | 1000 | `STRIPE_PRO_PRICE_ID` |
| Enterprise Subscription | $99.00/month | 5000 | `STRIPE_ENTERPRISE_PRICE_ID` |

## Environment Variables Reference

### Backend (.env)
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:5173

# Price IDs
STRIPE_TEST_PRICE_ID=price_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_POPULAR_PRICE_ID=price_...
STRIPE_BEST_VALUE_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
```

### Frontend (.env)
```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3000/api
```

## Webhook Events Required
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

## Test Cards
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`

## Quick Commands

### Local Development
```bash
# Backend
npm run start:dev

# Frontend
npm run dev

# Webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### Testing
```bash
# Test webhook events
stripe trigger checkout.session.completed

# View webhook logs
stripe logs tail
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Webhook signature fails | Check webhook secret |
| Credits not added | Check webhook events |
| Payment not completing | Check success/cancel URLs |
| CORS errors | Check allowed origins |

## Next Steps
1. Test all payment flows
2. Verify webhook processing
3. Check payment history
4. Test subscription management
5. Prepare for production deployment

For detailed instructions, see [STRIPE_SETUP.md](../STRIPE_SETUP.md).
