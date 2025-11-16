export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number; // Price in cents
  badge?: 'POPULAR' | 'BEST_VALUE';
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  credits: number;
  price: number; // Price in cents
  interval: 'month' | 'year';
  badge?: 'POPULAR' | 'BEST_VALUE';
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'test',
    name: 'Test Pack',
    credits: 10,
    price: 1000, // $10.00 (you mentioned thin pack is $10)
  },
];

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  // Monthly plans
  {
    id: 'pro',
    name: 'Pro',
    credits: 1000,
    price: 2900,
    interval: 'month',
    badge: 'POPULAR', // $29.00/month
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    credits: 5000,
    price: 9900,
    interval: 'month',
    badge: 'BEST_VALUE', // $99.00/month
  },
  // Yearly plans
  {
    id: 'pro-yearly',
    name: 'Pro',
    credits: 12000,
    price: 29000,
    interval: 'year',
    badge: 'POPULAR', // $290.00/year (20% savings)
  },
  {
    id: 'enterprise-yearly',
    name: 'Enterprise',
    credits: 60000,
    price: 99000,
    interval: 'year',
    badge: 'BEST_VALUE', // $990.00/year (20% savings)
  },
];

export function getCreditPackageById(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}

export function getSubscriptionPlanById(
  id: string,
): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
}
