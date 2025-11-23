import { Injectable, Logger } from '@nestjs/common';
import { CheckoutSessionService } from './services/checkout-session.service';
import { SubscriptionService, SubscriptionInfo } from './services/subscription.service';
import { CreditLedgerService, PaymentHistoryItem } from './services/credit-ledger.service';
import { PlanConfigService } from './services/plan-config.service';
import { SanitizedUser } from '../users/types';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import Stripe from 'stripe';

export { CreateCheckoutSessionDto };
export type { PaymentHistoryItem };
export type { SubscriptionInfo };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly checkoutSessionService: CheckoutSessionService,
    private readonly subscriptionService: SubscriptionService,
    private readonly creditLedgerService: CreditLedgerService,
    private readonly planConfigService: PlanConfigService,
  ) { }

  async createOneTimePurchaseSession(
    user: SanitizedUser,
    packageId: string,
  ): Promise<{ sessionId: string; url: string }> {
    return this.checkoutSessionService.createOneTimePurchaseSession(user, packageId);
  }

  async createSubscriptionSession(
    user: SanitizedUser,
    planId: string,
  ): Promise<{ sessionId: string; url: string }> {
    return this.checkoutSessionService.createSubscriptionSession(user, planId);
  }

  async handleSuccessfulPayment(session: Stripe.Checkout.Session): Promise<void> {
    return this.checkoutSessionService.handleSuccessfulPayment(session);
  }

  async handleSuccessfulSubscriptionFromSession(
    subscription: Stripe.Subscription,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _session: Stripe.Checkout.Session,
  ): Promise<void> {
    return this.subscriptionService.handleSuccessfulSubscription(subscription);
  }

  async handleSuccessfulSubscription(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    return this.subscriptionService.handleSuccessfulSubscription(subscription);
  }

  async getUserPaymentHistory(
    userId: string,
    limit = 25,
  ): Promise<PaymentHistoryItem[]> {
    return this.creditLedgerService.getUserPaymentHistory(userId, limit);
  }

  async getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
    return this.subscriptionService.getUserSubscription(userId);
  }

  async cancelUserSubscription(userId: string): Promise<void> {
    return this.subscriptionService.cancelUserSubscription(userId);
  }

  async removeCancellation(userId: string): Promise<void> {
    return this.subscriptionService.removeCancellation(userId);
  }

  async upgradeSubscription(userId: string, planId: string): Promise<void> {
    return this.subscriptionService.upgradeSubscription(userId, planId);
  }

  async createCustomerPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    return this.checkoutSessionService.createCustomerPortalSession(userId, returnUrl);
  }

  async getSessionStatus(sessionId: string) {
    return this.checkoutSessionService.getSessionStatus(sessionId);
  }

  async getSessionStatusQuick(sessionId: string) {
    return this.checkoutSessionService.getSessionStatus(sessionId);
  }

  getSubscriptionPlans() {
    return this.planConfigService.getSubscriptionPlans();
  }

  getCreditPackages() {
    return this.planConfigService.getCreditPackages();
  }

  async findPaymentByIntentId(paymentIntentId: string) {
    return this.creditLedgerService.findPaymentByIntentId(paymentIntentId);
  }

  async refundCredits(userId: string, credits: number, reason: string): Promise<void> {
    return this.creditLedgerService.refundCredits(userId, credits, reason);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async addCreditsToUser(userId: string, credits: number, _paymentId: string | null): Promise<void> {
    return this.creditLedgerService.addCredits(userId, credits);
  }

  // Webhook delegates
  async updateSubscriptionStatus(subscription: Stripe.Subscription): Promise<void> {
    return this.subscriptionService.updateSubscriptionStatus(subscription);
  }

  async cancelSubscriptionByStripeId(stripeSubscriptionId: string): Promise<void> {
    return this.subscriptionService.cancelSubscriptionByStripeId(stripeSubscriptionId);
  }

  async handleRecurringPayment(invoice: Stripe.Invoice): Promise<void> {
    return this.subscriptionService.handleRecurringPayment(invoice);
  }

  async handleFailedPayment(invoice: Stripe.Invoice): Promise<void> {
    return this.subscriptionService.handleFailedPayment(invoice);
  }

  async updatePaymentStatus(paymentId: string, status: any): Promise<void> {
    await this.creditLedgerService.updatePaymentStatus(paymentId, status);
  }

  // Test helpers
  async completeTestPayment(sessionId: string) {
    return this.checkoutSessionService.handleSuccessfulPayment({ id: sessionId } as any);
  }

  async completePaymentByIntentId(paymentIntentId: string) {
    const payment = await this.creditLedgerService.findPaymentByIntentId(paymentIntentId);
    if (payment) {
      await this.creditLedgerService.updatePaymentStatus(payment.id, 'COMPLETED');
      await this.creditLedgerService.addCredits(payment.userId, payment.credits);
      return { status: 'success', payment };
    }
    return { status: 'not_found' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createManualSubscription(_body: any) {
    this.logger.warn('createManualSubscription not fully implemented in refactor');
    return { status: 'not_implemented' };
  }

  async completePaymentForUser(userId: string, sessionId: string, credits?: number) {
    const payment = await this.creditLedgerService.findPaymentBySessionId(sessionId);
    if (payment) {
      await this.creditLedgerService.updatePaymentStatus(payment.id, 'COMPLETED');
      const creditsToAdd = credits !== undefined ? credits : payment.credits;
      await this.creditLedgerService.addCredits(userId, creditsToAdd);
      return { paymentId: payment.id, status: 'COMPLETED' };
    }
    return { status: 'payment_not_found' };
  }

  async addCreditsDirectlyForTesting(sessionId: string) {
    return this.completeTestPayment(sessionId);
  }
}
