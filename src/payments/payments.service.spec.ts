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
      payment: {
        findUnique: jest.fn(),
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
      subscriptionCycle: {
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $executeRawUnsafe: jest.fn(),
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
    prisma.payment.findUnique = jest.fn().mockResolvedValue({
      id: 'pay_1',
      userId: 'user_1',
      status: 'PENDING',
      credits: 1000,
    });
    const addSpy = jest
      .spyOn(service as any, 'addCreditsToUser')
      .mockResolvedValue(undefined);

    await service.handleSuccessfulPayment(session);

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay_1' },
      data: { status: 'COMPLETED', stripePaymentIntentId: 'pi_123' },
    });
    expect(addSpy).toHaveBeenCalledWith('user_1', expect.any(Number), 'pay_1');
  });

  it('verifies payment status before granting credits in subscription checkout handler', async () => {
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
    const verifySpy = jest.spyOn(service as any, 'verifySubscriptionPaymentStatus')
      .mockResolvedValue({ isPaid: true, status: 'paid' });
    const creditsSpy = jest.spyOn(service as any, 'addCreditsToUser');

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
    expect(creditsSpy).toHaveBeenCalledWith('user_1', expect.any(Number), expect.any(String));
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
    const verifySpy = jest.spyOn(service as any, 'verifySubscriptionPaymentStatus')
      .mockResolvedValue({ isPaid: false, status: 'unpaid', reason: 'Payment not confirmed' });
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

  it('grants credits once on invoice and creates subscription cycle', async () => {
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
    expect(prisma.subscriptionCycle.create).toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledWith(
      'user_1',
      expect.any(Number),
      expect.any(String),
    );

    // Idempotency: second call sees existing payment by intent and skips
    prisma.payment.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'pay_existing' });
    await service.handleRecurringPayment(invoice);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('refundCredits increments credits using centralized function', async () => {
    await service.refundCredits('user_1', 10, 'test');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
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
    
    // Mock the SQL function to return the new balance
    prisma.$queryRawUnsafe = jest.fn().mockResolvedValue([{ apply_credit_delta: 1020 }]); // 20 + 1000
    prisma.user.findUnique = jest.fn()
      .mockResolvedValueOnce({ credits: 20, email: 'test@example.com' }) // before
      .mockResolvedValueOnce({ credits: 1020 }); // after

    await service.addCreditsToUser(userId, creditsToAdd, paymentId);

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT public.apply_credit_delta'),
      userId,
      creditsToAdd,
      'PAYMENT',
      'PAYMENT',
      paymentId,
      'stripe',
      'payment',
      null,
      expect.any(String)
    );
  });
});
