import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let checkoutSessionService: any;
  let subscriptionService: any;
  let creditLedgerService: any;
  let planConfigService: any;

  beforeEach(() => {
    checkoutSessionService = {
      createOneTimePurchaseSession: jest.fn(),
      createSubscriptionSession: jest.fn(),
      handleSuccessfulPayment: jest.fn(),
      createCustomerPortalSession: jest.fn(),
      getSessionStatus: jest.fn(),
    };
    subscriptionService = {
      handleSuccessfulSubscription: jest.fn(),
      getUserSubscription: jest.fn(),
      cancelUserSubscription: jest.fn(),
      removeCancellation: jest.fn(),
      upgradeSubscription: jest.fn(),
      updateSubscriptionStatus: jest.fn(),
      cancelSubscriptionByStripeId: jest.fn(),
      handleRecurringPayment: jest.fn(),
      handleFailedPayment: jest.fn(),
    };
    creditLedgerService = {
      getUserPaymentHistory: jest.fn(),
      findPaymentByIntentId: jest.fn(),
      refundCredits: jest.fn(),
      addCredits: jest.fn(),
      updatePaymentStatus: jest.fn(),
      findPaymentBySessionId: jest.fn(),
    };
    planConfigService = {
      getSubscriptionPlans: jest.fn(),
      getCreditPackages: jest.fn(),
    };

    service = new PaymentsService(
      checkoutSessionService,
      subscriptionService,
      creditLedgerService,
      planConfigService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('delegates createOneTimePurchaseSession to CheckoutSessionService', async () => {
    const user = { authUserId: 'u1' } as any;
    await service.createOneTimePurchaseSession(user, 'pkg1');
    expect(checkoutSessionService.createOneTimePurchaseSession).toHaveBeenCalledWith(user, 'pkg1');
  });

  it('delegates createSubscriptionSession to CheckoutSessionService', async () => {
    const user = { authUserId: 'u1' } as any;
    await service.createSubscriptionSession(user, 'plan1');
    expect(checkoutSessionService.createSubscriptionSession).toHaveBeenCalledWith(user, 'plan1');
  });

  it('delegates handleSuccessfulPayment to CheckoutSessionService', async () => {
    const session = { id: 's1' } as any;
    await service.handleSuccessfulPayment(session);
    expect(checkoutSessionService.handleSuccessfulPayment).toHaveBeenCalledWith(session);
  });

  it('completePaymentForUser delegates to CreditLedgerService', async () => {
    creditLedgerService.findPaymentBySessionId.mockResolvedValue({ id: 'p1', credits: 100, userId: 'u1' });
    await service.completePaymentForUser('u1', 's1');
    expect(creditLedgerService.updatePaymentStatus).toHaveBeenCalledWith('p1', 'COMPLETED');
    expect(creditLedgerService.addCredits).toHaveBeenCalledWith('u1', 100);
  });
});
