
import { config } from 'dotenv';
config();
import { getPlanByStripePriceId } from './src/config/plans.config';

// The Price ID from the debug output
const TARGET_PRICE_ID = 'price_1SfkbeBEB6zYRY4SN3gUJl2K';

console.log('--- Verifying Plan Configuration ---');
console.log(`Checking Price ID: ${TARGET_PRICE_ID}`);

const plan = getPlanByStripePriceId(TARGET_PRICE_ID);

if (plan) {
    console.log('✅ Plan FOUND:');
    console.log(JSON.stringify(plan, null, 2));
} else {
    console.log('❌ Plan NOT FOUND for this Price ID.');
    console.log('Available Env Vars relating to Stripe Prices:');
    Object.keys(process.env).filter(k => k.includes('STRIPE') && k.includes('PRICE_ID')).forEach(k => {
        console.log(`${k}: ${process.env[k]}`);
    });
}
