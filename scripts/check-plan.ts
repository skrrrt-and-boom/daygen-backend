import { getPlanByStripePriceId, getSubscriptionPlanById } from '../src/config/plans.config';

const priceId = 'price_1SfkZ8BEB6zYRY4SnUut9p7p';
const plan = getPlanByStripePriceId(priceId);
console.log('Price ID:', priceId);
console.log('Plan found:', plan);
console.log('Credits:', plan?.credits);
