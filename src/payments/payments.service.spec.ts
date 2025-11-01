import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StripeService } from './stripe.service';

describe('PaymentsService', () => {
  let prisma: any;
  let users: any;
  let stripe: any;
  let service: PaymentsService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // subscriptionCycle removed in metered billing
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    } as unknown as PrismaService;

    users = {
      findByEmail: jest.fn(),
      findByAuthUserId: jest.fn(),
    } as unknown as UsersService;

    stripe = {
      retrieveSession: jest.fn(),
      retrieveSubscription: jest.fn(),
      retrieveCustomer: jest.fn(),
      cancelSubscription: jest.fn(),
      removeCancellation: jest.fn(),
      updateSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
    } as unknown as StripeService;

    // Minimal env for price id mapping
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_ent';
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_year';
    process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID = 'price_ent_year';

    service = new PaymentsService(prisma, stripe, users);
  });

  it('updates pending payment to completed on successful checkout payment', async () => {
    const session = { id: 'cs_123', payment_intent: 'pi_123' } as any;
    const mockTransaction = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pay_1',
          userId: 'user_1',
          status: 'PENDING',
          credits: 1000,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction = jest
      .fn()
      .mockImplementation((callback) => callback(mockTransaction));

    await service.handleSuccessfulPayment(session);

    expect(mockTransaction.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay_1' },
      data: { status: 'COMPLETED', stripePaymentIntentId: 'pi_123' },
    });
    expect(mockTransaction.user.update).toHaveBeenCalledWith({
      where: { authUserId: 'user_1' },
      data: { credits: { increment: 1000 } },
    });
  });

  it('verifies payment status in subscription checkout handler (no credits granted)', async () => {
    const subscription = {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro' } }] },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    } as any;
    const session = { id: 'cs_abc', metadata: { userId: 'user_1' } } as any;
    users.findByAuthUserId = jest
      .fn()
      .mockResolvedValue({ authUserId: 'user_1' });

    // Mock payment verification to return successful
    const verifySpy = jest
      .spyOn(service as any, 'verifySubscriptionPaymentStatus')
      .mockResolvedValue({ isPaid: true, status: 'paid' });
    const creditsSpy = jest.spyOn(service as any, 'addCreditsToUser');

    // Mock payment.create to return a payment with id
    prisma.payment.create = jest.fn().mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      status: 'COMPLETED',
      credits: 1000,
    });

    // Mock user lookup for addCreditsToUser
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      id: 'user_1',
      authUserId: 'user_1',
      credits: 20,
      email: 'test@example.com',
    });

    await service.handleSuccessfulSubscriptionFromSession(
      subscription,
      session,
    );

    expect(verifySpy).toHaveBeenCalledWith(subscription, session);
    expect(prisma.subscription.create).toHaveBeenCalled();
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        stripeSessionId: 'cs_abc',
        amount: expect.any(Number),
        credits: expect.any(Number),
        status: 'COMPLETED',
        type: 'SUBSCRIPTION',
        metadata: expect.any(Object),
      },
    });
    expect(creditsSpy).not.toHaveBeenCalled();
  });

  it('does not grant credits when payment verification fails', async () => {
    const subscription = {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro' } }] },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    } as any;
    const session = { id: 'cs_abc', metadata: { userId: 'user_1' } } as any;
    users.findByAuthUserId = jest
      .fn()
      .mockResolvedValue({ authUserId: 'user_1' });

    // Mock payment verification to return failed
    const verifySpy = jest
      .spyOn(service as any, 'verifySubscriptionPaymentStatus')
      .mockResolvedValue({
        isPaid: false,
        status: 'unpaid',
        reason: 'Payment not confirmed',
      });
    const creditsSpy = jest.spyOn(service as any, 'addCreditsToUser');

    await service.handleSuccessfulSubscriptionFromSession(
      subscription,
      session,
    );

    expect(verifySpy).toHaveBeenCalledWith(subscription, session);
    expect(prisma.subscription.create).toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(creditsSpy).not.toHaveBeenCalled();
  });

  it('records invoice payment without credit grants or subscription cycles', async () => {
    prisma.subscription.findUnique = jest.fn().mockResolvedValue({
      id: 'sub_db_1',
      userId: 'user_1',
      stripePriceId: 'price_pro',
    });
    prisma.payment.findUnique = jest.fn().mockResolvedValue(null);
    prisma.payment.create = jest.fn().mockResolvedValue({ id: 'pay_new' });
    const addSpy = jest
      .spyOn(service as any, 'addCreditsToUser')
      .mockResolvedValue(undefined);

    const invoice = {
      id: 'in_1',
      subscription: 'sub_1',
      payment_intent: 'pi_22',
      amount_paid: 2900,
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 3600,
    } as any;

    await service.handleRecurringPayment(invoice);

    expect(prisma.payment.create).toHaveBeenCalled();
    // subscriptionCycle no longer created
    expect(prisma.subscriptionCycle?.create).toBeUndefined();
    expect(addSpy).not.toHaveBeenCalled();

    // Idempotency: second call sees existing payment by intent and skips
    prisma.payment.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'pay_existing' });
    await service.handleRecurringPayment(invoice);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('refundCredits decrements user credits via prisma update', async () => {
    prisma.user.findUnique = jest
      .fn()
      .mockResolvedValue({ credits: 50, email: 'x@y.z' });
    prisma.user.update = jest.fn().mockResolvedValue({ credits: 40 });
    await service.refundCredits('user_1', 10, 'test');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate credit grant when first invoice arrives after checkout', async () => {
    const subscription = {
      id: 'sub_db_1',
      userId: 'user_1',
      stripePriceId: 'price_pro',
    };
    const invoice = {
      id: 'in_1',
      subscription: 'sub_1',
      payment_intent: 'pi_22',
      amount_paid: 2900,
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 3600,
    } as any;

    prisma.subscription.findUnique = jest.fn().mockResolvedValue(subscription);
    prisma.payment.findUnique = jest.fn().mockResolvedValue(null);
    prisma.payment.findFirst = jest.fn().mockResolvedValue({
      id: 'pay_existing',
      metadata: { periodStart: invoice.period_start },
    });
    prisma.payment.create = jest.fn().mockResolvedValue({ id: 'pay_new' });
    const addSpy = jest.spyOn(service as any, 'addCreditsToUser');

    await service.handleRecurringPayment(invoice);

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('adds credits to user correctly', async () => {
    const userId = 'user_1';
    const creditsToAdd = 1000;
    const paymentId = 'pay_1';

    // Mock user lookup and update
    prisma.user.findUnique = jest
      .fn()
      .mockResolvedValue({ credits: 20, email: 'test@example.com' });
    prisma.user.update = jest.fn().mockResolvedValue({ credits: 1020 });

    await service.addCreditsToUser(userId, creditsToAdd, paymentId);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { authUserId: userId },
      select: { credits: true, email: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { authUserId: userId },
      data: { credits: 1020 },
    });
  });

  it('completes enterprise monthly pending payment preserving plan and price', async () => {
    const userId = 'user_1';
    const sessionId = 'cs_test_abc123';

    // Pending payment with enterprise monthly plan
    const pendingPayment = {
      id: 'pay_pending',
      userId,
      status: 'PENDING',
      credits: 5000,
      amount: 9900,
      type: 'SUBSCRIPTION',
      metadata: {
        planId: 'enterprise',
        planName: 'Enterprise',
        billingPeriod: 'monthly',
      },
    };

    // Mock lookups
    prisma.payment.findUnique = jest.fn().mockResolvedValue(pendingPayment);
    prisma.user.findUnique = jest
      .fn()
      .mockResolvedValue({ authUserId: userId, email: 't@t.t', credits: 20 });

    // Transaction mocks
    const tx = {
      payment: {
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...pendingPayment,
          ...data,
        })),
        create: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub_new' }),
        update: jest.fn(),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;

    prisma.$transaction = jest.fn().mockImplementation(async (cb) => cb(tx));

    // Call
    const result = await service.completePaymentForUser(userId, sessionId);

    // Expect payment was completed with preserved plan metadata
    expect(tx.payment.update).toHaveBeenCalled();
    const updateArgs = (tx.payment.update as jest.Mock).mock.calls[0][0];
    expect(updateArgs.data.amount).toBe(9900);
    expect(updateArgs.data.credits).toBe(5000);
    expect(updateArgs.data.metadata.planId).toBe('enterprise');
    expect(updateArgs.data.metadata.billingPeriod).toBe('monthly');

    // Expect subscription created with enterprise monthly price id
    expect(tx.subscription.create).toHaveBeenCalled();
    const createArgs = (tx.subscription.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.stripePriceId).toBe('price_ent');

    // User credits updated correctly
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { authUserId: userId },
      data: { credits: 5020 },
    });

    // Response includes IDs
    expect(result.paymentId).toBe('pay_pending');
    expect(result.subscriptionId).toBe('sub_new');
  });

  it('is idempotent when creating subscription session for the same session id', async () => {
    const user = { authUserId: 'user_1' } as any;
    const dtoPlanId = 'enterprise';

    // Mock no active subscription
    (service as any).getUserSubscription = jest.fn().mockResolvedValue(null);

    // Mock plan price id mapping
    process.env.STRIPE_ENTERPRISE_PRICE_ID = 'price_ent';

    // Stripe returns same session.id
    (stripe.createCheckoutSession as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 'cs_same', url: 'https://stripe/session' });

    // First call: no existing by session, allow create
    prisma.payment.findUnique = jest
      .fn()
      .mockResolvedValueOnce(null) // before create
      .mockResolvedValueOnce({
        id: 'pay_existing',
        stripeSessionId: 'cs_same',
      }); // second call sees existing
    prisma.payment.create = jest.fn().mockResolvedValue({ id: 'pay_new' });

    // Act: first call
    const first = await service.createSubscriptionSession(user, dtoPlanId);
    expect(first.sessionId).toBe('cs_same');
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);

    // Act: second call (same inputs)
    const second = await service.createSubscriptionSession(user, dtoPlanId);
    expect(second.sessionId).toBe('cs_same');
    // Still only one create due to idempotent guard
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });
});
