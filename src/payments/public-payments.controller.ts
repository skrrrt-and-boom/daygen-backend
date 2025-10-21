import { Controller, Get, Param, Post, Body } from '@nestjs/common';
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

  @Get('session/:sessionId')
  async getSessionStatus(@Param('sessionId') sessionId: string) {
    return this.paymentsService.getSessionStatus(sessionId);
  }

  @Post('test/create-manual-subscription')
  async createManualSubscription(
    @Body()
    body: {
      userEmail: string;
      planId: string;
      credits: number;
      amount: number;
      paymentIntentId: string;
      stripeSubscriptionId: string;
      stripePriceId: string;
    },
  ) {
    return this.paymentsService.createManualSubscription(body);
  }
}
