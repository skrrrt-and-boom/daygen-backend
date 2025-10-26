import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { CreateCheckoutSessionDto } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout')
  async createCheckoutSession(
    @CurrentUser() user: SanitizedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    this.logger.log(
      `Creating checkout session for user ${user.authUserId}, type: ${dto.type}, package: ${dto.packageId}`,
    );

    if (dto.type === 'one_time') {
      return this.paymentsService.createOneTimePurchaseSession(
        user,
        dto.packageId,
      );
    } else if (dto.type === 'subscription') {
      return this.paymentsService.createSubscriptionSession(
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
      const history = await this.paymentsService.getUserPaymentHistory(
        user.authUserId,
      );
      return history;
    } catch (error) {
      this.logger.error(
        `Error fetching payment history for user ${user.authUserId}:`,
        error,
      );
      // Return empty array instead of throwing to handle users with no payments gracefully
      return [];
    }
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() user: SanitizedUser) {
    try {
      const subscription = await this.paymentsService.getUserSubscription(
        user.authUserId,
      );
      return subscription || null;
    } catch (error) {
      this.logger.error(
        `Error fetching subscription for user ${user.authUserId}:`,
        error,
      );
      // Return null to gracefully handle errors (e.g., no subscription)
      return null;
    }
  }

  @Post('subscription/cancel')
  async cancelSubscription(@CurrentUser() user: SanitizedUser) {
    await this.paymentsService.cancelUserSubscription(user.authUserId);
    return { message: 'Subscription cancelled successfully' };
  }

  @Post('subscription/remove-cancellation')
  async removeCancellation(@CurrentUser() user: SanitizedUser) {
    await this.paymentsService.removeCancellation(user.authUserId);
    return { message: 'Cancellation removed successfully' };
  }

  @Post('subscription/upgrade')
  async upgradeSubscription(
    @CurrentUser() user: SanitizedUser,
    @Body() body: { planId: string },
  ) {
    if (!body.planId) {
      throw new BadRequestException('Plan ID is required');
    }

    await this.paymentsService.upgradeSubscription(
      user.authUserId,
      body.planId,
    );
    return { message: 'Subscription upgraded successfully' };
  }

  @Post('test/complete-payment/:sessionId')
  @UseGuards() // Override the class-level guard for this test endpoint
  completeTestPayment(@Param('sessionId') sessionId: string) {
    console.log(
      `🎯 CONTROLLER: Manual payment completion requested for session: ${sessionId}`,
    );
    this.logger.log(
      `🎯 CONTROLLER: Manual payment completion requested for session: ${sessionId}`,
    );
    return this.paymentsService.completeTestPayment(sessionId);
  }

  @Get('session/:sessionId/status')
  getSessionStatus(@Param('sessionId') sessionId: string) {
    return this.paymentsService.getSessionStatus(sessionId);
  }

  @Get('subscription-plans')
  getSubscriptionPlans() {
    return this.paymentsService.getSubscriptionPlans();
  }

  @Get('find-by-intent/:paymentIntentId')
  findPaymentByIntent(@Param('paymentIntentId') paymentIntentId: string) {
    return this.paymentsService.findPaymentByIntentId(paymentIntentId);
  }

  @Post('test/complete-by-intent/:paymentIntentId')
  completePaymentByIntent(@Param('paymentIntentId') paymentIntentId: string) {
    return this.paymentsService.completePaymentByIntentId(paymentIntentId);
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
    return this.paymentsService.createManualSubscription(body);
  }
}
