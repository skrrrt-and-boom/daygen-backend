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
- [ ] Create 9 products with prices (see product list below)
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

---

## Required Products

### Subscriptions - Monthly

| Product | Price | Credits | Price ID Variable |
|---------|-------|---------|-------------------|
| Starter Monthly | $39.00/month | 200 | `STRIPE_STARTER_PRICE_ID` |
| Pro Monthly | $99.00/month | 1,000 | `STRIPE_PRO_PRICE_ID` |
| Agency Monthly | $299.00/month | 4,000 | `STRIPE_AGENCY_PRICE_ID` |

### Subscriptions - Yearly (20% savings)

| Product | Price | Credits | Price ID Variable |
|---------|-------|---------|-------------------|
| Starter Yearly | $374.40/year | 2,400 | `STRIPE_STARTER_YEARLY_PRICE_ID` |
| Pro Yearly | $950.40/year | 12,000 | `STRIPE_PRO_YEARLY_PRICE_ID` |
| Agency Yearly | $2,870.40/year | 48,000 | `STRIPE_AGENCY_YEARLY_PRICE_ID` |

### Top-Up Packages (One-Time)

| Product | Price | Credits | Price ID Variable |
|---------|-------|---------|-------------------|
| Starter Top-Up | $19.00 | 100 | `STRIPE_STARTER_TOPUP_PRICE_ID` |
| Pro Top-Up | $79.00 | 500 | `STRIPE_PRO_TOPUP_PRICE_ID` |
| Agency Top-Up | $249.00 | 2,000 | `STRIPE_AGENCY_TOPUP_PRICE_ID` |

---

## Environment Variables Reference

### Backend (.env)
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:5173

# Monthly Subscriptions
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_AGENCY_PRICE_ID=price_...

# Yearly Subscriptions
STRIPE_STARTER_YEARLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_AGENCY_YEARLY_PRICE_ID=price_...

# Top-Ups
STRIPE_STARTER_TOPUP_PRICE_ID=price_...
STRIPE_PRO_TOPUP_PRICE_ID=price_...
STRIPE_AGENCY_TOPUP_PRICE_ID=price_...
```

### Frontend (.env)
```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3000/api
```

---

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
5. See [STRIPE_PRODUCTION_CHECKLIST.md](./STRIPE_PRODUCTION_CHECKLIST.md) for production deployment
