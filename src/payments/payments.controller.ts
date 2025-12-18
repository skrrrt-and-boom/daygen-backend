import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import type { SanitizedUser } from '../users/types';
import { SubscriptionService } from './services/subscription.service';
import { CreditLedgerService } from './services/credit-ledger.service';
import { UserWalletService } from './services/user-wallet.service';
import { StripeService } from './stripe.service';
import {
  getSubscriptionPlans,
  getCreditPackages,
  getDefaultGraceLimit,
} from '../config/plans.config';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly creditLedgerService: CreditLedgerService,
    private readonly userWalletService: UserWalletService,
    private readonly stripeService: StripeService,
  ) { }

  @Public()
  @Get('config')
  getStripeConfig() {
    return {
      creditPackages: getCreditPackages(),
      subscriptionPlans: getSubscriptionPlans(),
    };
  }

  @Public()
  @Get('public/url-config')
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

  @Get('subscription-plans')
  getSubscriptionPlans() {
    return getSubscriptionPlans();
  }

  @Post('create-checkout')
  async createCheckoutSession(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    this.logger.log(
      `Creating checkout session for user ${user.authUserId}, type: ${dto.type}, package: ${dto.packageId}`,
    );

    if (dto.type === 'one_time') {
      return this.creditLedgerService.createOneTimePurchaseSession(
        user,
        dto.packageId,
      );
    } else if (dto.type === 'subscription') {
      return this.subscriptionService.createSubscriptionSession(
        user,
        dto.packageId,
      );
    } else {
      throw new BadRequestException('Invalid payment type');
    }
  }

  @Get('history')
  async getPaymentHistory(@CurrentUser() user: SanitizedUser) {
    try {
      const history = await this.creditLedgerService.getUserPaymentHistory(
        user.authUserId,
      );
      return history;
    } catch (error) {
      this.logger.error(
        `Error fetching payment history for user ${user.authUserId}:`,
        error,
      );
      return [];
    }
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() user: SanitizedUser) {
    try {
      const subscription = await this.subscriptionService.getUserSubscription(
        user.authUserId,
      );
      return subscription || null;
    } catch (error) {
      this.logger.error(
        `Error fetching subscription for user ${user.authUserId}:`,
        error,
      );
      return null;
    }
  }

  // ============ DUAL-WALLET ENDPOINTS ============

  @Get('wallet/balance')
  async getWalletBalance(@CurrentUser() user: SanitizedUser) {
    try {
      return await this.userWalletService.getBalance(user.authUserId);
    } catch (error) {
      this.logger.error(
        `Error fetching wallet balance for user ${user.authUserId}:`,
        error,
      );
      // Return legacy credits as fallback
      return {
        subscriptionCredits: 0,
        topUpCredits: (user as any).credits || 0,
        totalCredits: (user as any).credits || 0,
        subscriptionExpiresAt: null,
        graceLimit: getDefaultGraceLimit(),
      };
    }
  }

  @Get('wallet/transactions')
  async getWalletTransactions(@CurrentUser() user: SanitizedUser) {
    try {
      return await this.userWalletService.getTransactionHistory(user.authUserId);
    } catch (error) {
      this.logger.error(
        `Error fetching wallet transactions for user ${user.authUserId}:`,
        error,
      );
      return [];
    }
  }

  @Post('subscription/cancel')
  async cancelSubscription(@CurrentUser() user: SanitizedUser) {
    await this.subscriptionService.cancelUserSubscription(user.authUserId);
    return { message: 'Subscription cancelled successfully' };
  }

  @Post('subscription/remove-cancellation')
  async removeCancellation(@CurrentUser() user: SanitizedUser) {
    await this.subscriptionService.removeCancellation(user.authUserId);
    return { message: 'Cancellation removed successfully' };
  }

  @Post('subscription/upgrade')
  async upgradeSubscription(
    @CurrentUser() user: SanitizedUser,
    @Body() body: UpgradeSubscriptionDto,
  ) {
    await this.subscriptionService.upgradeSubscription(
      user.authUserId,
      body.planId,
    );
    return { message: 'Subscription upgraded successfully' };
  }

  @Post('portal')
  async createPortal(@CurrentUser() user: SanitizedUser) {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const baseUrl = nodeEnv === 'production'
      ? (process.env.FRONTEND_URL || 'https://daygen.ai')
      : (process.env.FRONTEND_URL || 'http://localhost:5173');
    const { url } = await this.subscriptionService.createCustomerPortalSession(
      user.authUserId,
      `${baseUrl}/account/billing`,
    );
    return { url };
  }

  @Public()
  @Get('session/:sessionId/status')
  getSessionStatus(@Param('sessionId') sessionId: string) {
    return this.creditLedgerService.getSessionStatus(sessionId);
  }

  @Public()
  @Get('session/:sessionId/quick-status')
  getSessionStatusQuick(@Param('sessionId') sessionId: string) {
    return this.creditLedgerService.getSessionStatus(sessionId);
  }

  // TEST ENDPOINTS
  @Get('find-by-intent/:paymentIntentId')
  findPaymentByIntent(@Param('paymentIntentId') paymentIntentId: string) {
    return this.creditLedgerService.findPaymentByIntentId(paymentIntentId);
  }

  @Post('test/complete-payment/:sessionId')
  async completeTestPayment(@Param('sessionId') sessionId: string) {
    this.checkTestEnv();

    this.logger.log(`🎯 TEST: Manual payment completion for session: ${sessionId}`);

    // Simulate successful payment
    return this.creditLedgerService.handleSuccessfulPayment({ id: sessionId } as any);
  }

  @Post('test/complete-by-intent/:paymentIntentId')
  async completePaymentByIntent(@Param('paymentIntentId') paymentIntentId: string) {
    this.checkTestEnv();

    const payment = await this.creditLedgerService.findPaymentByIntentId(paymentIntentId);
    if (payment) {
      await this.creditLedgerService.updatePaymentStatus(payment.id, 'COMPLETED');
      await this.creditLedgerService.addCredits(payment.userId, payment.credits);
      return { status: 'success', payment };
    }
    return { status: 'not_found' };
  }

  @Post('test/create-manual-subscription')
  createManualSubscription(
    @Body()
    _body: {
      userEmail: string;
      planId: string;
      credits: number;
      amount: number;
      paymentIntentId: string;
      stripeSubscriptionId: string;
      stripePriceId: string;
    },
  ) {
    this.checkTestEnv();
    // This was not fully implemented in refactor plan as it's a test helper
    // If absolutely needed, I would implement it in SubscriptionService
    throw new BadRequestException('Manual subscription creation not supported in refactor');
  }

  private checkTestEnv() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Test endpoints are not available in production',
      );
    }
  }
}
