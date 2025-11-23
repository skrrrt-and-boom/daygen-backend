import { Injectable } from '@nestjs/common';

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

@Injectable()
export class PlanConfigService {
    private readonly creditPackages: CreditPackage[] = [
        {
            id: 'test',
            name: 'Test Pack',
            credits: 10,
            price: 1000, // $10.00
        },
    ];

    private readonly subscriptionPlans: SubscriptionPlan[] = [
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

    getCreditPackages(): CreditPackage[] {
        return this.creditPackages;
    }

    getSubscriptionPlans(): SubscriptionPlan[] {
        return this.subscriptionPlans;
    }

    getCreditPackageById(id: string): CreditPackage | undefined {
        return this.creditPackages.find((pkg) => pkg.id === id);
    }

    getSubscriptionPlanById(id: string): SubscriptionPlan | undefined {
        return this.subscriptionPlans.find((plan) => plan.id === id);
    }

    getPriceIdForPackage(packageId: string): string {
        const priceIdMap: Record<string, string> = {
            test: process.env.STRIPE_TEST_PRICE_ID || '',
        };
        return priceIdMap[packageId] || '';
    }

    getPriceIdForSubscription(planId: string): string {
        const priceIdMap: Record<string, string> = {
            // Monthly plans
            pro: process.env.STRIPE_PRO_PRICE_ID || '',
            enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
            // Yearly plans
            'pro-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
            'enterprise-yearly': process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '',
        };
        return priceIdMap[planId] || '';
    }

    getPlanByStripePriceId(stripePriceId: string): SubscriptionPlan | undefined {
        // Reverse lookup from env vars
        const reversePriceIdMap: Record<string, string> = {
            [process.env.STRIPE_PRO_PRICE_ID || '']: 'pro',
            [process.env.STRIPE_ENTERPRISE_PRICE_ID || '']: 'enterprise',
            [process.env.STRIPE_PRO_YEARLY_PRICE_ID || '']: 'pro-yearly',
            [process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '']: 'enterprise-yearly',
        };

        let planId = reversePriceIdMap[stripePriceId];

        // Fallback for placeholders/mocks if env vars match placeholders
        if (!planId) {
            const placeholderMap: Record<string, string> = {
                price_pro: 'pro',
                price_enterprise: 'enterprise',
                price_pro_yearly: 'pro-yearly',
                price_enterprise_yearly: 'enterprise-yearly',
                pro: 'pro',
                enterprise: 'enterprise',
                'pro-yearly': 'pro-yearly',
                'enterprise-yearly': 'enterprise-yearly',
            };
            planId = placeholderMap[stripePriceId];
        }

        if (!planId) return undefined;
        return this.getSubscriptionPlanById(planId);
    }
}
