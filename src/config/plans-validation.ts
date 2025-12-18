import { Logger } from '@nestjs/common';

/**
 * Validates that all required Stripe Price IDs are configured.
 * Should be called at application startup to fail fast if config is incomplete.
 */
export function validateStripePriceIds(): void {
    const logger = new Logger('PlanConfigValidation');

    const nodeEnv = process.env.NODE_ENV || 'development';

    // In development/test, warn but don't block startup
    const isProduction = nodeEnv === 'production';

    // Required subscription price IDs
    const requiredSubscriptionPriceIds = [
        'STRIPE_STARTER_PRICE_ID',
        'STRIPE_PRO_PRICE_ID',
        'STRIPE_AGENCY_PRICE_ID',
        'STRIPE_STARTER_YEARLY_PRICE_ID',
        'STRIPE_PRO_YEARLY_PRICE_ID',
        'STRIPE_AGENCY_YEARLY_PRICE_ID',
    ];

    // Required top-up package price IDs
    const requiredTopUpPriceIds = [
        'STRIPE_STARTER_TOPUP_PRICE_ID',
        'STRIPE_PRO_TOPUP_PRICE_ID',
        'STRIPE_AGENCY_TOPUP_PRICE_ID',
    ];

    const missingEnvVars: string[] = [];

    // Check subscription price IDs
    for (const envVar of requiredSubscriptionPriceIds) {
        if (!process.env[envVar]) {
            missingEnvVars.push(envVar);
        }
    }

    // Check top-up price IDs
    for (const envVar of requiredTopUpPriceIds) {
        if (!process.env[envVar]) {
            missingEnvVars.push(envVar);
        }
    }

    if (missingEnvVars.length > 0) {
        const message = `Missing Stripe Price ID environment variables:\n${missingEnvVars.map(v => `  - ${v}`).join('\n')}`;

        if (isProduction) {
            logger.error(message);
            throw new Error(
                `Payment system configuration error: ${missingEnvVars.length} required Stripe Price IDs are missing. ` +
                `Please configure all required environment variables before starting the application.`
            );
        } else {
            logger.warn(message + '\n\nPayment features may not work correctly. This warning will become an error in production.');
        }
    } else {
        logger.log('✓ All Stripe Price IDs are configured');
    }
}

/**
 * Validates a single price ID at runtime, throwing a clear error if empty.
 * Use this when retrieving a price ID for checkout.
 */
export function requirePriceId(priceId: string, planId: string): string {
    if (!priceId || priceId.trim() === '') {
        throw new Error(
            `Stripe Price ID not configured for plan "${planId}". ` +
            `Please set the corresponding STRIPE_*_PRICE_ID environment variable.`
        );
    }
    return priceId;
}
