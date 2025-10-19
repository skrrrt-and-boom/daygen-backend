import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  Param, 
  UseGuards, 
  Logger,
  BadRequestException 
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
    @Body() dto: CreateCheckoutSessionDto
  ) {
    this.logger.log(`Creating checkout session for user ${user.authUserId}, type: ${dto.type}, package: ${dto.packageId}`);

    if (dto.type === 'one_time') {
      return this.paymentsService.createOneTimePurchaseSession(user, dto.packageId);
    } else if (dto.type === 'subscription') {
      return this.paymentsService.createSubscriptionSession(user, dto.packageId);
    } else {
      throw new BadRequestException('Invalid payment type');
    }
  }

  @Get('session/:sessionId')
  async getSessionStatus(
    @CurrentUser() user: SanitizedUser,
    @Param('sessionId') sessionId: string
  ) {
    return this.paymentsService.getSessionStatus(sessionId);
  }

  @Get('history')
  async getPaymentHistory(@CurrentUser() user: SanitizedUser) {
    return this.paymentsService.getUserPaymentHistory(user.authUserId);
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() user: SanitizedUser) {
    return this.paymentsService.getUserSubscription(user.authUserId);
  }

  @Post('subscription/cancel')
  async cancelSubscription(@CurrentUser() user: SanitizedUser) {
    await this.paymentsService.cancelUserSubscription(user.authUserId);
    return { message: 'Subscription cancelled successfully' };
  }

  @Get('config')
  getConfig() {
    return {
      creditPackages: this.paymentsService.getCreditPackages(),
      subscriptionPlans: this.paymentsService.getSubscriptionPlans(),
    };
  }
}
