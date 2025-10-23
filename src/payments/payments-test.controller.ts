import {
  Controller,
  Post,
  Param,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments-test')
export class PaymentsTestController {
  private readonly logger = new Logger(PaymentsTestController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('complete-payment/:sessionId')
  async completeTestPayment(@Param('sessionId') sessionId: string) {
    console.log(`🎯 TEST CONTROLLER: Manual payment completion requested for session: ${sessionId}`);
    this.logger.log(`🎯 TEST CONTROLLER: Manual payment completion requested for session: ${sessionId}`);
    
    // Always use direct credit addition for testing
    console.log(`🧪 Using direct credit addition for test session: ${sessionId}`);
    this.logger.log(`🧪 Using direct credit addition for test session: ${sessionId}`);
    return await this.paymentsService.addCreditsDirectlyForTesting(sessionId);
  }

  @Post('add-credits-direct')
  async addCreditsDirect() {
    console.log(`🧪 DIRECT CREDIT ADDITION endpoint called`);
    this.logger.log(`🧪 DIRECT CREDIT ADDITION endpoint called`);
    return await this.paymentsService.addCreditsDirectlyForTesting('direct-test');
  }

  @Post('simple-test')
  async simpleTest() {
    console.log(`🧪 SIMPLE TEST endpoint called`);
    this.logger.log(`🧪 SIMPLE TEST endpoint called`);
    return { message: 'Simple test endpoint working!', timestamp: new Date().toISOString() };
  }
}
