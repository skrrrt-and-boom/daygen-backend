import {
  Controller,
  Post,
  Param,
  Logger,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments-test')
export class PaymentsTestController {
  private readonly logger = new Logger(PaymentsTestController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('complete-payment/:sessionId')
  async completeTestPayment(@Param('sessionId') sessionId: string) {
    console.log(
      `🎯 TEST CONTROLLER: Manual payment completion requested for session: ${sessionId}`,
    );
    this.logger.log(
      `🎯 TEST CONTROLLER: Manual payment completion requested for session: ${sessionId}`,
    );

    // Use systematic solution for test sessions
    console.log(
      `🧪 Using systematic payment completion for test session: ${sessionId}`,
    );
    this.logger.log(
      `🧪 Using systematic payment completion for test session: ${sessionId}`,
    );
    return await this.paymentsService.addCreditsDirectlyForTesting(sessionId);
  }

  @Post('add-credits-direct')
  async addCreditsDirect() {
    console.log(`🧪 DIRECT CREDIT ADDITION endpoint called`);
    this.logger.log(`🧪 DIRECT CREDIT ADDITION endpoint called`);
    return await this.paymentsService.addCreditsDirectlyForTesting(
      'direct-test',
    );
  }

  @Post('simple-test')
  simpleTest() {
    console.log(`🧪 SIMPLE TEST endpoint called`);
    this.logger.log(`🧪 SIMPLE TEST endpoint called`);
    return {
      message: 'Simple test endpoint working!',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('complete-payment-for-user')
  async completePaymentForUser(
    @Body() body: { userId: string; sessionId: string; credits?: number },
  ) {
    try {
      console.log(`🎯 SYSTEMATIC PAYMENT COMPLETION for user: ${body.userId}`);
      this.logger.log(
        `🎯 SYSTEMATIC PAYMENT COMPLETION for user: ${body.userId}`,
      );

      const { userId, sessionId, credits = 12000 } = body;
      console.log(
        `📝 Request details: userId=${userId}, sessionId=${sessionId}, credits=${credits}`,
      );

      const result = await this.paymentsService.completePaymentForUser(
        userId,
        sessionId,
        credits,
      );
      console.log(`✅ Systematic payment completion successful:`, result);
      return result;
    } catch (error) {
      console.error(`💥 Error in systematic payment completion:`, error);
      this.logger.error(`💥 Error in systematic payment completion:`, error);

      // Handle specific error types with appropriate HTTP status codes
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
        }
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate')
        ) {
          throw new HttpException(error.message, HttpStatus.CONFLICT);
        }
        if (
          error.message.includes('constraint') ||
          error.message.includes('unique')
        ) {
          throw new HttpException(
            'Payment already processed for this session',
            HttpStatus.CONFLICT,
          );
        }
      }

      // Default to internal server error for unexpected errors
      throw new HttpException(
        'Internal server error during payment completion',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
