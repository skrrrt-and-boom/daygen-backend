import { Controller, Get } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('public-payments')
export class PublicPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('config')
  getStripeConfig() {
    return {
      creditPackages: this.paymentsService.getCreditPackages(),
      subscriptionPlans: this.paymentsService.getSubscriptionPlans(),
    };
  }
}
