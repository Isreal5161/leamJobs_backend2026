import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { initializeFlutterwavePayment, verifyFlutterwaveTransaction } from './flutterwave.service.js';
import { recordSubscriptionEvent } from './subscriptionFoundation.service.js';
import { addBillingInterval, getEffectiveSubscriptionStatus, reconcileExpiredSubscriptionsForUser } from './subscriptionLifecycle.service.js';
import { createNotification } from './notification.service.js';

export class SeekerSubscriptionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SeekerSubscriptionError';
    this.status = status;
  }
}

const toDecimal = (value) => new Prisma.Decimal(String(value ?? 0));
const normalizeCurrency = (value) => String(value ?? '').trim().toUpperCase();

const notifySubscriptionPaymentFailure = async ({ userId, subscriptionId, paymentId, planName, client = prisma }) => createNotification({
  recipientUserId: userId,
  type: 'ALERT',
  category: 'PAYMENT',
  eventKey: `subscription:payment-failed:${paymentId}`,
  title: 'Subscription payment failed',
  message: `We could not complete payment for your ${planName ?? 'subscription'}.`,
  link: '/seeker/payments',
  metadata: { subscriptionId, paymentId },
}, client).catch(() => undefined);

const paymentSelect = {
  id: true,
  userId: true,
  subscriptionId: true,
  providerReference: true,
  transactionId: true,
  idempotencyKey: true,
  amount: true,
  currency: true,
  status: true,
  paymentType: true,
  provider: true,
  metadata: true,
  verifiedAt: true,
  createdAt: true,
};

const subscriptionSelect = {
  id: true,
  userId: true,
  planId: true,
  status: true,
  priceSnapshot: true,
  currencySnapshot: true,
  billingIntervalSnapshot: true,
  startDate: true,
  endDate: true,
  cancelledAt: true,
  cancellationReason: true,
  nextRenewalAt: true,
  createdAt: true,
  updatedAt: true,
  plan: { select: { id: true, key: true, displayName: true, description: true, price: true, currency: true, billingInterval: true, isActive: true, isPublic: true, benefits: true, entitlements: { select: { entitlement: { select: { key: true } } } } } },
  payments: { where: { paymentType: 'SUBSCRIPTION' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5, select: paymentSelect },
};

const serializePayment = (payment) => ({
  id: payment.id,
  subscriptionId: payment.subscriptionId,
  providerReference: payment.providerReference,
  transactionId: payment.transactionId,
  amount: payment.amount ? payment.amount.toString() : null,
  currency: payment.currency,
  status: payment.status,
  paymentType: payment.paymentType,
  provider: payment.provider,
  verifiedAt: payment.verifiedAt,
  createdAt: payment.createdAt,
  checkoutUrl: payment.metadata?.checkoutUrl ?? null,
});

const serializeSubscription = (subscription) => ({
  id: subscription.id,
  userId: subscription.userId,
  planId: subscription.planId,
  status: subscription.status,
  priceSnapshot: subscription.priceSnapshot ? subscription.priceSnapshot.toString() : null,
  currencySnapshot: subscription.currencySnapshot,
  billingIntervalSnapshot: subscription.billingIntervalSnapshot,
  startDate: subscription.startDate,
  endDate: subscription.endDate,
  cancelledAt: subscription.cancelledAt,
  cancellationReason: subscription.cancellationReason,
  nextRenewalAt: subscription.nextRenewalAt,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
  plan: subscription.plan ? {
    id: subscription.plan.id,
    key: subscription.plan.key,
    displayName: subscription.plan.displayName,
    description: subscription.plan.description,
    price: subscription.plan.price ? subscription.plan.price.toString() : null,
    currency: subscription.plan.currency,
    billingInterval: subscription.plan.billingInterval,
    active: subscription.plan.isActive,
    public: subscription.plan.isPublic,
    benefits: Array.isArray(subscription.plan.benefits) ? subscription.plan.benefits : [],
    entitlements: (subscription.plan.entitlements ?? []).map(({ entitlement }) => entitlement.key),
  } : null,
  payments: (subscription.payments ?? []).map(serializePayment),
});

const ensureSeekerPlan = async (planId) => {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      key: true,
      displayName: true,
      description: true,
      price: true,
      currency: true,
      billingInterval: true,
      isActive: true,
      isPublic: true,
      benefits: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!plan) {
    throw new SeekerSubscriptionError('Subscription plan not found', 404);
  }
  if (!plan.isActive) {
    throw new SeekerSubscriptionError('This subscription plan is not available', 409);
  }
  if (!plan.isPublic) {
    throw new SeekerSubscriptionError('This subscription plan is not publicly available for purchase', 403);
  }
  if (!plan.price || !plan.currency || !/^[A-Z]{3}$/.test(plan.currency.toUpperCase())) {
    throw new SeekerSubscriptionError('This subscription plan does not have a valid price and currency', 422);
  }
  const amount = toDecimal(plan.price);
  if (!amount.gt(0)) {
    throw new SeekerSubscriptionError('The subscription plan must have a positive price', 422);
  }
  if (plan.billingInterval !== 'MONTHLY') {
    throw new SeekerSubscriptionError('Unsupported billing interval for this subscription plan', 422);
  }

  return {
    ...plan,
    price: amount,
    currency: plan.currency.toUpperCase(),
  };
};

const getCurrentActiveSubscription = async (userId, client = prisma) => {
  const now = new Date();
  return client.subscription.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      startDate: { not: null, lte: now },
      endDate: { not: null, gt: now },
    },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: subscriptionSelect,
  });
};

const isCurrentSubscription = (subscription, now = new Date()) => (
  subscription?.status === 'ACTIVE'
  && subscription.startDate
  && subscription.startDate <= now
  && subscription.endDate
  && subscription.endDate > now
);

export const getSeekerSubscriptionState = async (userId) => {
  await reconcileExpiredSubscriptionsForUser(userId);
  const activeSubscription = await getCurrentActiveSubscription(userId);
  if (!activeSubscription) {
    return { currentSubscription: null, plan: null, hasActiveSubscription: false };
  }

  return { currentSubscription: serializeSubscription(activeSubscription), plan: activeSubscription.plan ? { ...activeSubscription.plan, price: activeSubscription.plan.price ? activeSubscription.plan.price.toString() : null } : null, hasActiveSubscription: true };
};

export const initializeSeekerSubscriptionCheckout = async ({ userId, planId, idempotencyKey }) => {
  const plan = await ensureSeekerPlan(planId);
  await reconcileExpiredSubscriptionsForUser(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true } });
  if (!user) {
    throw new SeekerSubscriptionError('Seeker not found', 404);
  }

  const activeSubscription = await getCurrentActiveSubscription(userId);
  if (activeSubscription) {
    throw new SeekerSubscriptionError('You already have an active subscription', 409);
  }

  const requestedKey = idempotencyKey?.trim();
  if (requestedKey && requestedKey.length > 100) {
    throw new SeekerSubscriptionError('Idempotency key is too long', 400);
  }

  const pendingKey = requestedKey || `subscription:${userId}:${planId}:${crypto.randomUUID()}`;

  try {
    return await prisma.$transaction(async (transaction) => {
    const activeNow = await getCurrentActiveSubscription(userId, transaction);
    if (activeNow) {
      throw new SeekerSubscriptionError('You already have an active subscription', 409);
    }

    const priorPayment = await transaction.payment.findFirst({
      where: { userId, paymentType: 'SUBSCRIPTION', idempotencyKey: pendingKey },
      select: { ...paymentSelect, subscription: { select: { id: true, status: true, plan: { select: { id: true, key: true, displayName: true } } } } },
    });

    if (priorPayment) {
      const subscription = priorPayment.subscription ?? await transaction.subscription.findUnique({ where: { id: priorPayment.subscriptionId }, select: subscriptionSelect });
      return {
        alreadyInitialized: true,
        checkoutUrl: priorPayment.metadata?.checkoutUrl ?? null,
        payment: serializePayment(priorPayment),
        subscription: subscription ? serializeSubscription(subscription) : null,
      };
    }

    const subscription = await transaction.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: 'PENDING',
        priceSnapshot: plan.price,
        currencySnapshot: plan.currency,
        billingIntervalSnapshot: plan.billingInterval,
        startDate: new Date(),
        nextRenewalAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: subscriptionSelect,
    });

    const providerReference = `leamjobs_sub_${userId}_${crypto.randomUUID()}`;
    const payment = await transaction.payment.create({
      data: {
        userId,
        subscriptionId: subscription.id,
        providerReference,
        idempotencyKey: pendingKey,
        amount: plan.price,
        currency: plan.currency,
        status: 'PENDING',
        paymentType: 'SUBSCRIPTION',
        provider: 'FLUTTERWAVE',
        metadata: { userId, planId: plan.id, subscriptionId: subscription.id, checkoutUrl: null },
      },
      select: paymentSelect,
    });

    await recordSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'PAYMENT_PENDING', providerReference, metadata: { userId, paymentId: payment.id, planKey: plan.key } }, transaction);

    try {
      const checkout = await initializeFlutterwavePayment({
        amount: plan.price.toFixed(2),
        currency: plan.currency,
        email: user.email,
        txRef: providerReference,
        meta: { userId, planId: plan.id, subscriptionId: subscription.id },
        redirectUrl: `${env.FRONTEND_URL}/seeker/payments?plan=${encodeURIComponent(plan.key)}`,
      });

      const updatedPayment = await transaction.payment.update({
        where: { id: payment.id },
        data: { metadata: { ...payment.metadata, checkoutUrl: checkout.checkoutUrl, providerReference, providerStatus: 'initialized' } },
        select: paymentSelect,
      });

      return {
        alreadyInitialized: false,
        checkoutUrl: checkout.checkoutUrl,
        payment: serializePayment(updatedPayment),
        subscription: serializeSubscription({ ...subscription, payments: [updatedPayment] }),
      };
    } catch (error) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', metadata: { ...(payment.metadata ?? {}), checkoutUrl: null, failure: error.message }, verifiedAt: new Date() },
      }).catch(() => undefined);
      await transaction.subscription.update({
        where: { id: subscription.id },
        data: { status: 'FAILED' },
      }).catch(() => undefined);
      await recordSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'PAYMENT_FAILED', providerReference, metadata: { error: error.message, step: 'checkout_init' } }, transaction).catch(() => undefined);
      await notifySubscriptionPaymentFailure({ userId, subscriptionId: subscription.id, paymentId: payment.id, planName: plan.displayName, client: transaction });
      throw error;
    }
    });
  } catch (error) {
    if (error?.code === 'P2002' && requestedKey) {
      const existingPayment = await prisma.payment.findUnique({
        where: { idempotencyKey: requestedKey },
        select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
      });
      if (existingPayment?.userId === userId) {
        const subscription = existingPayment.subscription ?? await prisma.subscription.findUnique({ where: { id: existingPayment.subscriptionId }, select: subscriptionSelect });
        return {
          alreadyInitialized: true,
          checkoutUrl: existingPayment.metadata?.checkoutUrl ?? null,
          payment: serializePayment(existingPayment),
          subscription: subscription ? serializeSubscription(subscription) : null,
        };
      }
      if (existingPayment) throw new SeekerSubscriptionError('This idempotency key is already in use', 409);
    }
    throw error;
  }
};

export const verifySeekerSubscriptionPayment = async ({ userId, providerReference, transactionId }) => {
  if (!providerReference && !transactionId) {
    throw new SeekerSubscriptionError('A Flutterwave transaction reference is required', 400);
  }

  await reconcileExpiredSubscriptionsForUser(userId);

  const payment = await prisma.payment.findFirst({
    where: {
      userId,
      paymentType: 'SUBSCRIPTION',
      ...(providerReference ? { providerReference } : {}),
      ...(transactionId ? { transactionId: String(transactionId) } : {}),
    },
    select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
  });

  if (!payment) {
    throw new SeekerSubscriptionError('Subscription payment record not found', 404);
  }
  if (payment.provider !== 'FLUTTERWAVE') {
    throw new SeekerSubscriptionError('Unsupported subscription payment provider', 422);
  }

  if (payment.status === 'SUCCESSFUL') {
    const subscription = payment.subscription ?? await prisma.subscription.findUnique({ where: { id: payment.subscriptionId }, select: subscriptionSelect });
    return { payment: serializePayment(payment), subscription: subscription ? serializeSubscription(subscription) : null, alreadyVerified: true };
  }

  const markVerificationFailure = async ({ reason, providerStatus, resolvedTransactionId, metadata = {} }) => {
    const transitioned = await prisma.$transaction(async (transaction) => {
      const currentPayment = await transaction.payment.findUnique({ where: { id: payment.id }, select: { status: true, subscriptionId: true, metadata: true } });
      if (!currentPayment || currentPayment.status !== 'PENDING') return false;
      if (currentPayment.subscriptionId) {
        const currentSubscription = await transaction.subscription.findUnique({ where: { id: currentPayment.subscriptionId }, select: { status: true } });
        if (!currentSubscription || currentSubscription.status !== 'PENDING') return false;
      }

      const updatedPayment = await transaction.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED', ...(resolvedTransactionId ? { transactionId: resolvedTransactionId } : {}), verifiedAt: new Date(), metadata: { ...(currentPayment.metadata ?? {}), ...metadata, verificationFailure: reason, ...(providerStatus ? { providerStatus } : {}) } },
      });
      if (updatedPayment.count !== 1) return false;

      if (currentPayment.subscriptionId) {
        const updatedSubscription = await transaction.subscription.updateMany({ where: { id: currentPayment.subscriptionId, status: 'PENDING' }, data: { status: 'FAILED' } });
        if (updatedSubscription.count !== 1) throw new SeekerSubscriptionError('Subscription verification state changed during processing', 409);
        await recordSubscriptionEvent({ subscriptionId: currentPayment.subscriptionId, eventType: 'PAYMENT_FAILED', providerReference: payment.providerReference, metadata: { reason, ...(resolvedTransactionId ? { transactionId: resolvedTransactionId } : {}), ...(providerStatus ? { providerStatus } : {}) } }, transaction);
      }
      return true;
    });

    if (transitioned && payment.subscriptionId) {
      await notifySubscriptionPaymentFailure({ userId, subscriptionId: payment.subscriptionId, paymentId: payment.id, planName: payment.subscription?.plan?.displayName });
    }
    return transitioned;
  };

  if (!transactionId || !/^[0-9]+$/.test(String(transactionId))) {
    throw new SeekerSubscriptionError('A valid Flutterwave transaction ID is required', 400);
  }

  let providerPayment;
  try {
    providerPayment = await verifyFlutterwaveTransaction(String(transactionId));
  } catch (error) {
    await markVerificationFailure({ reason: error.message, resolvedTransactionId: String(transactionId), metadata: { step: 'verification' } }).catch(() => undefined);
    throw error;
  }

  const txRef = String(providerPayment.tx_ref || providerPayment.reference || '');
  const amount = String(providerPayment.amount ?? providerPayment.amount_paid ?? '0');
  const currency = normalizeCurrency(providerPayment.currency);
  const providerTransactionId = String(providerPayment.id || providerPayment.flw_ref || providerPayment.transaction_id || transactionId);

  if (providerPayment.status !== 'successful' || txRef !== payment.providerReference || !new Prisma.Decimal(amount).eq(new Prisma.Decimal(String(payment.amount)))) {
    await markVerificationFailure({ reason: 'verification_failed', providerStatus: providerPayment.status, resolvedTransactionId: providerTransactionId });
    throw new SeekerSubscriptionError('Flutterwave payment verification failed', 422);
  }

  if (currency !== payment.currency) {
    await markVerificationFailure({ reason: 'currency_mismatch', providerStatus: providerPayment.status, resolvedTransactionId: providerTransactionId, metadata: { providerCurrency: currency, expectedCurrency: payment.currency } });
    throw new SeekerSubscriptionError('Currency mismatch detected during subscription verification', 422);
  }

  return prisma.$transaction(async (transaction) => {
    const currentPayment = await transaction.payment.findUnique({ where: { id: payment.id }, select: { ...paymentSelect, subscription: { select: subscriptionSelect } } });
    if (currentPayment.status === 'SUCCESSFUL') {
      const subscription = currentPayment.subscription ?? await transaction.subscription.findUnique({ where: { id: currentPayment.subscriptionId }, select: subscriptionSelect });
      return { payment: serializePayment(currentPayment), subscription: subscription ? serializeSubscription(subscription) : null, alreadyVerified: true };
    }

    const activeSubscription = await getCurrentActiveSubscription(userId, transaction);
    if (activeSubscription && currentPayment.subscriptionId && activeSubscription.id !== currentPayment.subscriptionId) {
      throw new SeekerSubscriptionError('An active subscription already exists for this user', 409);
    }

    const activationTime = new Date();
    const endDate = addBillingInterval(activationTime, currentPayment.subscription?.billingIntervalSnapshot);
    const activated = await transaction.subscription.updateMany({
      where: { id: currentPayment.subscriptionId, status: 'PENDING' },
      data: {
        status: 'ACTIVE',
        startDate: activationTime,
        endDate,
      },
    });
    if (activated.count !== 1) {
      throw new SeekerSubscriptionError('This subscription is no longer pending', 409);
    }

    const updatedPayment = await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESSFUL',
        transactionId: providerTransactionId,
        verifiedAt: new Date(),
        metadata: { ...(currentPayment.metadata ?? {}), providerStatus: providerPayment.status, verifiedAt: new Date().toISOString() },
      },
      select: paymentSelect,
    });

    const updatedSubscription = await transaction.subscription.findUnique({
      where: { id: currentPayment.subscriptionId },
      select: subscriptionSelect,
    });

    await recordSubscriptionEvent({ subscriptionId: updatedSubscription.id, eventType: 'PAYMENT_SUCCESSFUL', providerReference: payment.providerReference, metadata: { paymentId: updatedPayment.id, transactionId: providerTransactionId, amount: updatedPayment.amount.toString(), currency: updatedPayment.currency } }, transaction);
    await recordSubscriptionEvent({ subscriptionId: updatedSubscription.id, eventType: 'ACTIVATED', providerReference: payment.providerReference, metadata: { activatedAt: new Date().toISOString(), planId: updatedSubscription.planId } }, transaction);
    await createNotification({
      recipientUserId: userId,
      actorUserId: null,
      type: 'SUCCESS',
      category: 'SUBSCRIPTION',
      eventKey: `subscription:activated:${updatedSubscription.id}`,
      title: 'Subscription activated',
      message: `Your ${updatedSubscription.plan?.displayName ?? 'subscription'} is now active.`,
      link: '/seeker/payments',
    }, transaction).catch(() => undefined);

    return { payment: serializePayment(updatedPayment), subscription: serializeSubscription(updatedSubscription), alreadyVerified: false };
  });
};

export const listSeekerPlanOptions = async () => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    select: {
      id: true,
      key: true,
      displayName: true,
      description: true,
      price: true,
      currency: true,
      billingInterval: true,
      isActive: true,
      isPublic: true,
      benefits: true,
    },
  });

  return plans.map((plan) => ({
    id: plan.id,
    key: plan.key,
    displayName: plan.displayName,
    description: plan.description,
    price: plan.price ? plan.price.toString() : null,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    active: plan.isActive,
    public: plan.isPublic,
    benefits: Array.isArray(plan.benefits) ? plan.benefits : [],
  }));
};

export const listSeekerSubscriptions = async (userId) => {
  await reconcileExpiredSubscriptionsForUser(userId);
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: subscriptionSelect,
  });

  return {
    subscriptions: subscriptions.map((subscription) => serializeSubscription({ ...subscription, status: getEffectiveSubscriptionStatus(subscription) })),
    currentSubscription: subscriptions.find((subscription) => isCurrentSubscription(subscription)) ? serializeSubscription(subscriptions.find((subscription) => isCurrentSubscription(subscription))) : null,
    activeSubscription: subscriptions.find((subscription) => isCurrentSubscription(subscription)) ? serializeSubscription(subscriptions.find((subscription) => isCurrentSubscription(subscription))) : null,
  };
};
