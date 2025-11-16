import { Controller, Get, Param, Post, Body, ForbiddenException } from '@nestjs/common';
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
  getSessionStatus(@Param('sessionId') sessionId: string) {
    return this.paymentsService.getSessionStatus(sessionId);
  }

  @Get('session/:sessionId/quick-status')
  getSessionStatusQuick(@Param('sessionId') sessionId: string) {
    return this.paymentsService.getSessionStatusQuick(sessionId);
  }

  @Post('test/create-manual-subscription')
  createManualSubscription(
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
    // CRITICAL SECURITY: Block this endpoint entirely or add authentication
    // This endpoint is completely unprotected and allows unauthenticated subscription creation
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'This endpoint is disabled in production',
      );
    }
    
    // Additional check: Verify we're using test Stripe keys
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (stripeKey.startsWith('sk_live_')) {
      throw new ForbiddenException(
        'This endpoint is only available with test Stripe keys',
      );
    }
    
    return this.paymentsService.createManualSubscription(body);
  }

  @Get('test/url-config')
  getUrlConfig() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const frontendUrl = process.env.FRONTEND_URL;

    let baseUrl: string;
    if (nodeEnv === 'production') {
      baseUrl = frontendUrl || 'https://daygen.ai';
    } else {
      baseUrl = 'http://localhost:5173';
    }

    return {
      nodeEnv,
      frontendUrl,
      baseUrl,
      successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/payment/cancel?type=subscription&package=pro`,
    };
  }
}
