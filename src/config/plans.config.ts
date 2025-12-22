export interface CreditPackage {
    id: string;
    name: string;
    credits: number;
    price: number; // Price in cents
    badge?: 'POPULAR' | 'BEST_VALUE';
    description?: string;
}

export interface SubscriptionPlan {
    id: string;
    name: string;
    credits: number;
    price: number; // Price in cents
    interval: 'month' | 'year';
    badge?: 'POPULAR' | 'BEST_VALUE';
    features?: string[];
    videoMinutes?: number; // Approximate video duration in minutes
}

// Configurable grace limit - can be overridden via environment variable
export const DEFAULT_GRACE_LIMIT = parseInt(process.env.DEFAULT_GRACE_LIMIT || '50', 10);

export function getDefaultGraceLimit(): number {
    return DEFAULT_GRACE_LIMIT;
}

// Top-Up Credit Packages (perpetual - never expire)
// Names match subscription tier names for consistency
export const CREDIT_PACKAGES: CreditPackage[] = [
    {
        id: 'starter-topup',
        name: 'Starter',
        credits: 100,
        price: 1900, // $19.00
        description: '~1 minute of video',
    },
    {
        id: 'pro-topup',
        name: 'Pro',
        credits: 500,
        price: 7900, // $79.00
        badge: 'POPULAR',
        description: '~5 minutes of video',
    },
    {
        id: 'agency-topup',
        name: 'Agency',
        credits: 2000,
        price: 24900, // $249.00
        badge: 'BEST_VALUE',
        description: '~20 minutes of video',
    },
];

// Monthly subscription plans (reset each billing cycle)
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
    // Monthly plans
    {
        id: 'starter',
        name: 'Starter',
        credits: 200,
        price: 3900, // $39.00/month
        interval: 'month',
        videoMinutes: 2,
        features: ['~2 min video/month', 'Standard queue'],
    },
    {
        id: 'pro',
        name: 'Pro',
        credits: 1000,
        price: 9900, // $99.00/month
        interval: 'month',
        badge: 'POPULAR',
        videoMinutes: 10,
        features: ['~10 min video/month', 'Standard queue', 'Priority support'],
    },
    {
        id: 'agency',
        name: 'Agency',
        credits: 4000,
        price: 29900, // $299.00/month
        interval: 'month',
        badge: 'BEST_VALUE',
        videoMinutes: 40,
        features: ['~40 min video/month', 'Priority queue', 'Dedicated support'],
    },
    // Yearly plans (20% savings)
    {
        id: 'starter-yearly',
        name: 'Starter',
        credits: 2400, // 200 * 12
        price: 37440, // $374.40/year (20% off $468)
        interval: 'year',
        videoMinutes: 24,
        features: ['~24 min video/year', 'Standard queue'],
    },
    {
        id: 'pro-yearly',
        name: 'Pro',
        credits: 12000, // 1000 * 12
        price: 95040, // $950.40/year (20% off $1188)
        interval: 'year',
        badge: 'POPULAR',
        videoMinutes: 120,
        features: ['~120 min video/year', 'Standard queue', 'Priority support'],
    },
    {
        id: 'agency-yearly',
        name: 'Agency',
        credits: 48000, // 4000 * 12
        price: 287040, // $2870.40/year (20% off $3588)
        interval: 'year',
        badge: 'BEST_VALUE',
        videoMinutes: 480,
        features: ['~480 min video/year', 'Priority queue', 'Dedicated support'],
    },
];

// Legacy plan mappings for backward compatibility
const LEGACY_PLAN_MAPPING: Record<string, string> = {
    'enterprise': 'pro', // Old enterprise ($99) -> new pro ($99)
    'enterprise-yearly': 'pro-yearly',
};

export function getCreditPackages(): CreditPackage[] {
    return CREDIT_PACKAGES;
}

export function getSubscriptionPlans(): SubscriptionPlan[] {
    return SUBSCRIPTION_PLANS;
}

export function getCreditPackageById(id: string): CreditPackage | undefined {
    return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}

export function getSubscriptionPlanById(id: string): SubscriptionPlan | undefined {
    // Check for legacy plan mapping
    const effectiveId = LEGACY_PLAN_MAPPING[id] || id;
    return SUBSCRIPTION_PLANS.find((plan) => plan.id === effectiveId);
}

export function getPriceIdForPackage(packageId: string): string {
    const priceIdMap: Record<string, string> = {
        'starter-topup': process.env.STRIPE_STARTER_TOPUP_PRICE_ID || '',
        'pro-topup': process.env.STRIPE_PRO_TOPUP_PRICE_ID || '',
        'agency-topup': process.env.STRIPE_AGENCY_TOPUP_PRICE_ID || '',
        // Legacy
        test: process.env.STRIPE_TEST_PRICE_ID || '',
    };
    const priceId = priceIdMap[packageId];
    if (!priceId) {
        throw new Error(
            `Stripe Price ID not configured for package "${packageId}". ` +
            `Please set the corresponding STRIPE_*_TOPUP_PRICE_ID environment variable.`
        );
    }
    return priceId;
}

export function getPriceIdForSubscription(planId: string): string {
    const priceIdMap: Record<string, string> = {
        // Monthly plans
        starter: process.env.STRIPE_STARTER_PRICE_ID || '',
        pro: process.env.STRIPE_PRO_PRICE_ID || '',
        agency: process.env.STRIPE_AGENCY_PRICE_ID || '',
        // Yearly plans
        'starter-yearly': process.env.STRIPE_STARTER_YEARLY_PRICE_ID || '',
        'pro-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
        'agency-yearly': process.env.STRIPE_AGENCY_YEARLY_PRICE_ID || '',
        // Legacy mappings
        enterprise: process.env.STRIPE_PRO_PRICE_ID || '',
        'enterprise-yearly': process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
    };
    const priceId = priceIdMap[planId];
    if (!priceId) {
        throw new Error(
            `Stripe Price ID not configured for subscription plan "${planId}". ` +
            `Please set the corresponding STRIPE_*_PRICE_ID environment variable.`
        );
    }
    return priceId;
}

export function getPlanByStripePriceId(stripePriceId: string): SubscriptionPlan | undefined {
    // Build reverse lookup from env vars - only add entries with valid values
    const envMappings: Record<string, string> = {};

    const priceIdMappings = [
        { envVar: 'STRIPE_STARTER_PRICE_ID', planId: 'starter' },
        { envVar: 'STRIPE_PRO_PRICE_ID', planId: 'pro' },
        { envVar: 'STRIPE_AGENCY_PRICE_ID', planId: 'agency' },
        { envVar: 'STRIPE_STARTER_YEARLY_PRICE_ID', planId: 'starter-yearly' },
        { envVar: 'STRIPE_PRO_YEARLY_PRICE_ID', planId: 'pro-yearly' },
        { envVar: 'STRIPE_AGENCY_YEARLY_PRICE_ID', planId: 'agency-yearly' },
        // Legacy
        { envVar: 'STRIPE_ENTERPRISE_PRICE_ID', planId: 'pro' },
        { envVar: 'STRIPE_ENTERPRISE_YEARLY_PRICE_ID', planId: 'pro-yearly' },
    ];

    for (const { envVar, planId } of priceIdMappings) {
        const priceId = process.env[envVar];
        if (priceId) {
            envMappings[priceId] = planId;
        }
    }

    let planId = envMappings[stripePriceId];

    // Fallback for placeholders/mocks
    if (!planId) {
        const placeholderMap: Record<string, string> = {
            price_starter: 'starter',
            price_pro: 'pro',
            price_agency: 'agency',
            price_starter_yearly: 'starter-yearly',
            price_pro_yearly: 'pro-yearly',
            price_agency_yearly: 'agency-yearly',
            // Direct ID matching
            starter: 'starter',
            pro: 'pro',
            agency: 'agency',
            'starter-yearly': 'starter-yearly',
            'pro-yearly': 'pro-yearly',
            'agency-yearly': 'agency-yearly',
            // Legacy
            enterprise: 'pro',
            'enterprise-yearly': 'pro-yearly',
        };
        planId = placeholderMap[stripePriceId];
    }

    if (!planId) {
        return undefined;
    }

    const plan = getSubscriptionPlanById(planId);
    return plan;
}

/**
 * Check if a user qualifies for priority queue based on their plan
 */
export function hasPriorityQueue(planId: string): boolean {
    return planId === 'agency' || planId === 'agency-yearly';
}

/**
 * Validate all required Stripe price IDs are configured.
 * Should be called during application startup to fail fast.
 */
export function validateStripePriceIds(): void {
    const required = [
        { env: 'STRIPE_STARTER_PRICE_ID', plan: 'starter' },
        { env: 'STRIPE_PRO_PRICE_ID', plan: 'pro' },
        { env: 'STRIPE_AGENCY_PRICE_ID', plan: 'agency' },
        { env: 'STRIPE_STARTER_YEARLY_PRICE_ID', plan: 'starter-yearly' },
        { env: 'STRIPE_PRO_YEARLY_PRICE_ID', plan: 'pro-yearly' },
        { env: 'STRIPE_AGENCY_YEARLY_PRICE_ID', plan: 'agency-yearly' },
    ];

    const missing = required.filter(({ env }) => !process.env[env]);

    if (missing.length > 0) {
        throw new Error(
            `Missing required Stripe price IDs: ${missing.map(m => m.env).join(', ')}. ` +
            `Check your environment configuration.`
        );
    }
}

