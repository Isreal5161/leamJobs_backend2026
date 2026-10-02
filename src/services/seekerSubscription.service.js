import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { initializeFlutterwavePayment, verifyFlutterwaveTransaction } from './flutterwave.service.js';
import { recordSubscriptionEvent } from './subscriptionFoundation.service.js';
import { addBillingInterval, getEffectiveSubscriptionStatus, reconcileExpiredSubscriptionsForUser } from './subscriptionLifecycle.service.js';
import { createNotification } from './notification.service.js';
import { getActiveTrialForUser, getAiUsageState, resolveEffectiveEntitlements, startFreeTrial } from './subscriptionEntitlement.service.js';

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
  plan: { select: { id: true, key: true, displayName: true, description: true, price: true, currency: true, billingInterval: true, isActive: true, isPublic: true, benefits: true, aiAllowance: true, aiUnlimited: true, featureConfig: true, entitlements: { select: { entitlement: { select: { key: true } } } } } },
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
    aiAllowance: subscription.plan.aiAllowance ?? null,
    aiUnlimited: Boolean(subscription.plan.aiUnlimited),
    featureConfig: subscription.plan.featureConfig ?? {},
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
      aiAllowance: true,
      aiUnlimited: true,
      featureConfig: true,
      entitlements: { select: { entitlement: { select: { key: true } } } },
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
  const priorPaymentSelect = {
    ...paymentSelect,
    subscription: { select: { ...subscriptionSelect } },
  };
  let intent;

  try {
    intent = await prisma.$transaction(async (transaction) => {
      const priorPayment = await transaction.payment.findFirst({
        where: { idempotencyKey: pendingKey },
        select: priorPaymentSelect,
      });

      if (priorPayment) {
        if (priorPayment.userId !== userId) {
          throw new SeekerSubscriptionError('This idempotency key is already in use', 409);
        }
        if (priorPayment.paymentType !== 'SUBSCRIPTION' || priorPayment.subscription?.planId !== plan.id) {
          throw new SeekerSubscriptionError('This idempotency key belongs to a different plan', 409);
        }
        return { payment: priorPayment, subscription: priorPayment.subscription, alreadyInitialized: true };
      }

      const activeNow = await getCurrentActiveSubscription(userId, transaction);
      if (activeNow) {
        throw new SeekerSubscriptionError('You already have an active subscription', 409);
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

      const providerReference = `leamjobs_sub_${crypto.randomUUID()}`;
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
          metadata: { userId, planId: plan.id, planKey: plan.key, subscriptionId: subscription.id, customerEmail: user.email, checkoutUrl: null },
        },
        select: paymentSelect,
      });

      await recordSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'PAYMENT_PENDING', providerReference, metadata: { userId, paymentId: payment.id, planKey: plan.key } }, transaction);
      return { payment, subscription, alreadyInitialized: false };
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existingPayment = await prisma.payment.findFirst({ where: { idempotencyKey: pendingKey }, select: priorPaymentSelect });
    if (!existingPayment) throw error;
    if (existingPayment.userId !== userId) throw new SeekerSubscriptionError('This idempotency key is already in use', 409);
    if (existingPayment.paymentType !== 'SUBSCRIPTION' || existingPayment.subscription?.planId !== plan.id) {
      throw new SeekerSubscriptionError('This idempotency key belongs to a different plan', 409);
    }
    intent = { payment: existingPayment, subscription: existingPayment.subscription, alreadyInitialized: true };
  }

  const { payment, subscription, alreadyInitialized } = intent;
  const responseForExisting = async (existingPayment = payment, existingSubscription = subscription) => ({
    alreadyInitialized: true,
    checkoutUrl: existingPayment.metadata?.checkoutUrl ?? null,
    payment: serializePayment(existingPayment),
    subscription: existingSubscription ? serializeSubscription(existingSubscription) : null,
    initializing: existingPayment.status === 'PROCESSING',
  });

  if (alreadyInitialized) {
    if (payment.status !== 'PENDING') return responseForExisting();
    if (payment.metadata?.checkoutUrl) return responseForExisting();
  }

  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  });
  if (claimed.count !== 1) {
    const current = await prisma.payment.findUnique({ where: { id: payment.id }, select: priorPaymentSelect });
    if (!current || current.userId !== userId || current.subscription?.planId !== plan.id) {
      throw new SeekerSubscriptionError('Checkout state changed; please check your subscription status', 409);
    }
    return responseForExisting(current, current.subscription);
  }

  try {
    const checkout = await initializeFlutterwavePayment({
      amount: plan.price.toFixed(2),
      currency: plan.currency,
      email: user.email,
      customerName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || undefined,
      txRef: payment.providerReference,
      meta: { userId, planId: plan.id, planKey: plan.key, subscriptionId: subscription.id },
      redirectUrl: `${env.FRONTEND_URL_PROD || env.FRONTEND_URL}/seeker/subscription/payment-result?plan=${encodeURIComponent(plan.key)}`,
      title: `LeamJobs ${plan.displayName} subscription`,
    });

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PENDING',
        metadata: { ...(payment.metadata ?? {}), checkoutUrl: checkout.checkoutUrl, providerReference: payment.providerReference, providerStatus: 'initialized' },
      },
      select: paymentSelect,
    });
    const updatedSubscription = await prisma.subscription.findUnique({ where: { id: subscription.id }, select: subscriptionSelect });

    return {
      alreadyInitialized: false,
      checkoutUrl: checkout.checkoutUrl,
      payment: serializePayment(updatedPayment),
      subscription: updatedSubscription ? serializeSubscription({ ...updatedSubscription, payments: [updatedPayment] }) : null,
    };
  } catch (error) {
    await prisma.$transaction(async (transaction) => {
      const failed = await transaction.payment.updateMany({
        where: { id: payment.id, status: 'PROCESSING' },
        data: { status: 'FAILED', metadata: { ...(payment.metadata ?? {}), checkoutUrl: null, failure: error.message }, verifiedAt: new Date() },
      });
      if (failed.count !== 1) return;
      await transaction.subscription.updateMany({ where: { id: subscription.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      await recordSubscriptionEvent({ subscriptionId: subscription.id, eventType: 'PAYMENT_FAILED', providerReference: payment.providerReference, metadata: { error: error.message, step: 'checkout_init' } }, transaction);
    }).catch(() => undefined);
    await notifySubscriptionPaymentFailure({ userId, subscriptionId: subscription.id, paymentId: payment.id, planName: plan.displayName });
    throw error;
  }
};

export const cancelSeekerSubscriptionPayment = async ({ userId, providerReference }) => {
  const result = await prisma.$transaction(async (transaction) => {
    const paymentWhere = {
      userId,
      providerReference,
      paymentType: 'SUBSCRIPTION',
      provider: 'FLUTTERWAVE',
    };
    const paymentSelectForCancellation = {
      id: true,
      userId: true,
      subscriptionId: true,
      providerReference: true,
      status: true,
      paymentType: true,
      provider: true,
      subscription: { select: { id: true, userId: true, status: true } },
    };
    const readPayment = () => transaction.payment.findFirst({
      where: paymentWhere,
      select: paymentSelectForCancellation,
    });
    const payment = await readPayment();

    if (!payment) {
      throw new SeekerSubscriptionError('Subscription payment record not found', 404);
    }
    if (!payment.subscription
      || payment.subscriptionId !== payment.subscription.id
      || payment.userId !== userId
      || payment.subscription.userId !== userId) {
      console.warn('Subscription payment cancellation binding mismatch', { paymentId: payment.id, reason: 'user_subscription_binding' });
      throw new SeekerSubscriptionError('This payment is not linked to your subscription', 409);
    }

    if (payment.status === 'CANCELLED' && payment.subscription.status === 'CANCELLED') {
      return { status: 'CANCELLED' };
    }
    if (payment.status === 'SUCCESSFUL' || payment.subscription.status === 'ACTIVE') {
      throw new SeekerSubscriptionError('This payment can no longer be cancelled', 409);
    }
    if (payment.status !== 'PENDING' || payment.subscription.status !== 'PENDING') {
      throw new SeekerSubscriptionError('This payment is no longer awaiting cancellation', 409);
    }

    const cancelledAt = new Date();
    const subscriptionUpdate = await transaction.subscription.updateMany({
      where: { id: payment.subscriptionId, userId, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        cancellationReason: 'USER_CANCELLED_CHECKOUT',
      },
    });
    if (subscriptionUpdate.count !== 1) {
      const current = await readPayment();
      if (current?.status === 'CANCELLED' && current.subscription?.status === 'CANCELLED') {
        return { status: 'CANCELLED' };
      }
      throw new SeekerSubscriptionError('This payment can no longer be cancelled', 409);
    }

    const paymentUpdate = await transaction.payment.updateMany({
      where: {
        id: payment.id,
        userId,
        subscriptionId: payment.subscriptionId,
        providerReference,
        paymentType: 'SUBSCRIPTION',
        provider: 'FLUTTERWAVE',
        status: 'PENDING',
      },
      data: { status: 'CANCELLED' },
    });
    if (paymentUpdate.count !== 1) {
      const current = await readPayment();
      if (current?.status === 'CANCELLED' && current.subscription?.status === 'CANCELLED') {
        return { status: 'CANCELLED' };
      }
      throw new SeekerSubscriptionError('This payment can no longer be cancelled', 409);
    }

    await recordSubscriptionEvent({
      subscriptionId: payment.subscriptionId,
      eventType: 'CANCELLED',
      providerReference,
      metadata: { paymentId: payment.id, reason: 'USER_CANCELLED_CHECKOUT' },
    }, transaction);

    return { status: 'CANCELLED' };
  });

  return result;
};

export const verifySeekerSubscriptionPayment = async ({
  userId,
  providerReference,
  transactionId,
  returnProviderFailure = false,
  returnFailureState = false,
}) => {
  if (!providerReference && !transactionId) {
    throw new SeekerSubscriptionError('A Flutterwave transaction reference is required', 400);
  }

  await reconcileExpiredSubscriptionsForUser(userId);

  let providerPayment = null;
  let payment = await prisma.payment.findFirst({
    where: {
      userId,
      paymentType: 'SUBSCRIPTION',
      ...(providerReference ? { providerReference } : {}),
      ...(!providerReference && transactionId ? { transactionId: String(transactionId) } : {}),
    },
    select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
  });

  if (!payment && !providerReference && transactionId) {
    try {
      providerPayment = await verifyFlutterwaveTransaction(String(transactionId));
    } catch {
      throw new SeekerSubscriptionError('Payment confirmation is temporarily unavailable. Please check again shortly.', 503);
    }
    const resolvedReference = String(providerPayment.tx_ref || providerPayment.reference || '');
    if (!resolvedReference) throw new SeekerSubscriptionError('Flutterwave could not identify this payment', 422);
    payment = await prisma.payment.findFirst({
      where: { userId, paymentType: 'SUBSCRIPTION', providerReference: resolvedReference },
      select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
    });
  }

  if (!payment) {
    throw new SeekerSubscriptionError('Subscription payment record not found', 404);
  }
  if (payment.provider !== 'FLUTTERWAVE') {
    throw new SeekerSubscriptionError('Unsupported subscription payment provider', 422);
  }

  const subscription = payment.subscription ?? (payment.subscriptionId
    ? await prisma.subscription.findUnique({ where: { id: payment.subscriptionId }, select: subscriptionSelect })
    : null);
  if (!subscription || subscription.id !== payment.subscriptionId || subscription.userId !== userId || payment.userId !== userId) {
    console.warn('Subscription payment binding mismatch', { paymentId: payment.id, reason: 'user_subscription_binding' });
    throw new SeekerSubscriptionError('This payment is not linked to your subscription', 409);
  }
  if (payment.transactionId && transactionId && String(payment.transactionId) !== String(transactionId)) {
    throw new SeekerSubscriptionError('The transaction ID does not match this payment', 409);
  }
  const storedMetadata = payment.metadata ?? {};
  if ((storedMetadata.userId && String(storedMetadata.userId) !== userId)
    || (storedMetadata.planId && String(storedMetadata.planId) !== subscription.planId)
    || (storedMetadata.subscriptionId && String(storedMetadata.subscriptionId) !== subscription.id)
    || (storedMetadata.planKey && subscription.plan?.key && String(storedMetadata.planKey) !== subscription.plan.key)) {
    console.warn('Subscription payment binding mismatch', { paymentId: payment.id, reason: 'stored_metadata_binding' });
    throw new SeekerSubscriptionError('This payment is not linked to your subscription', 409);
  }

  if (payment.status === 'SUCCESSFUL') {
    return { payment: serializePayment(payment), subscription: subscription ? serializeSubscription(subscription) : null, alreadyVerified: true };
  }
  if (returnProviderFailure && payment.status === 'FAILED' && subscription.status === 'FAILED') {
    return { payment: serializePayment(payment), subscription: serializeSubscription(subscription), failed: true };
  }
  if (returnFailureState && payment.status === 'FAILED' && subscription.status === 'FAILED') {
    return {
      payment: serializePayment(payment),
      subscription: serializeSubscription(subscription),
      failed: true,
      failureType: payment.metadata?.providerStatus === 'cancelled' ? 'cancelled' : 'failed',
    };
  }
  if (payment.status === 'PROCESSING') {
    return { payment: serializePayment(payment), subscription: serializeSubscription(subscription), alreadyVerified: false, pending: true };
  }
  if (payment.status !== 'PENDING' || subscription.status !== 'PENDING') {
    throw new SeekerSubscriptionError('This payment is no longer awaiting verification', 409);
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

  const resolvedTransactionId = transactionId ?? payment.transactionId;
  if (!resolvedTransactionId) {
    return { payment: serializePayment(payment), subscription: serializeSubscription(subscription), alreadyVerified: false, pending: true };
  }
  if (!/^[0-9]+$/.test(String(resolvedTransactionId))) {
    throw new SeekerSubscriptionError('A valid Flutterwave transaction ID is required', 400);
  }

  if (!providerPayment) {
    try {
      providerPayment = await verifyFlutterwaveTransaction(String(resolvedTransactionId));
    } catch {
      throw new SeekerSubscriptionError('Payment confirmation is temporarily unavailable. Please check again shortly.', 503);
    }
  }

  const txRef = String(providerPayment.tx_ref || providerPayment.reference || '');
  const returnedTransactionId = providerPayment.id ?? providerPayment.transaction_id ?? providerPayment.flw_ref;
  if (txRef !== payment.providerReference) {
    console.warn('Subscription payment verification mismatch', { paymentId: payment.id, reason: 'provider_reference_mismatch' });
    throw new SeekerSubscriptionError('Flutterwave could not match this transaction to the payment', 422);
  }
  if (returnedTransactionId !== undefined && String(returnedTransactionId) !== String(resolvedTransactionId)) {
    console.warn('Subscription payment verification mismatch', { paymentId: payment.id, reason: 'transaction_id_mismatch' });
    throw new SeekerSubscriptionError('Flutterwave could not match this transaction to the payment', 422);
  }

  const providerStatus = String(providerPayment.status ?? '').toLowerCase();
  if (['pending', 'processing', 'queued', 'incomplete'].includes(providerStatus)) {
    return { payment: serializePayment(payment), subscription: serializeSubscription(subscription), alreadyVerified: false, pending: true };
  }
  if (providerStatus !== 'successful') {
    const transitioned = await markVerificationFailure({ reason: 'provider_payment_not_successful', providerStatus, resolvedTransactionId: String(returnedTransactionId ?? resolvedTransactionId) });
    if (returnProviderFailure || returnFailureState) {
      if (transitioned) {
        return {
          payment: serializePayment({ ...payment, status: 'FAILED', transactionId: String(returnedTransactionId ?? resolvedTransactionId) }),
          subscription: serializeSubscription({ ...subscription, status: 'FAILED' }),
          failed: true,
          ...(returnFailureState ? { failureType: ['cancelled', 'canceled'].includes(providerStatus) ? 'cancelled' : 'failed' } : {}),
        };
      }
      const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
      });
      const currentSubscription = currentPayment?.subscription;
      if (currentPayment?.status === 'SUCCESSFUL' && currentSubscription?.status === 'ACTIVE') {
        return { payment: serializePayment(currentPayment), subscription: serializeSubscription(currentSubscription), alreadyVerified: true };
      }
      if (currentPayment?.status === 'FAILED' && currentSubscription?.status === 'FAILED') {
        return {
          payment: serializePayment(currentPayment),
          subscription: serializeSubscription(currentSubscription),
          failed: true,
          ...(returnFailureState ? { failureType: ['cancelled', 'canceled'].includes(providerStatus) ? 'cancelled' : 'failed' } : {}),
        };
      }
      return {
        payment: serializePayment(currentPayment ?? payment),
        subscription: currentSubscription ? serializeSubscription(currentSubscription) : serializeSubscription(subscription),
        pending: true,
      };
    }
    throw new SeekerSubscriptionError('Flutterwave could not confirm a successful payment', 422);
  }

  const amount = String(providerPayment.amount ?? providerPayment.amount_paid ?? '0');
  const currency = normalizeCurrency(providerPayment.currency);
  const providerTransactionId = String(returnedTransactionId ?? transactionId);
  const providerMetadata = providerPayment.meta ?? providerPayment.metadata;
  const expectedPlanKey = subscription.plan?.key;
  const providerCustomerEmail = providerPayment.customer?.email;
  const expectedCustomerEmail = String(storedMetadata.customerEmail ?? (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? '').trim().toLowerCase();
  const providerCustomerEmailNormalized = String(providerCustomerEmail ?? '').trim().toLowerCase();
  let amountMatches = false;
  try {
    amountMatches = new Prisma.Decimal(amount).eq(new Prisma.Decimal(String(payment.amount)));
  } catch {
    amountMatches = false;
  }

  const metadataMatches = !providerMetadata || typeof providerMetadata !== 'object'
    || ((providerMetadata.userId === undefined || String(providerMetadata.userId) === userId)
      && (providerMetadata.planId === undefined || String(providerMetadata.planId) === subscription.planId)
      && (providerMetadata.subscriptionId === undefined || String(providerMetadata.subscriptionId) === subscription.id)
      && (providerMetadata.planKey === undefined || !expectedPlanKey || String(providerMetadata.planKey) === expectedPlanKey));
  const customerMatches = !providerCustomerEmailNormalized || !expectedCustomerEmail || providerCustomerEmailNormalized === expectedCustomerEmail;
  const subscriptionSnapshotMatches = (!subscription.priceSnapshot || new Prisma.Decimal(String(subscription.priceSnapshot)).eq(new Prisma.Decimal(String(payment.amount))))
    && (!subscription.currencySnapshot || normalizeCurrency(subscription.currencySnapshot) === normalizeCurrency(payment.currency));

  if (!amountMatches || currency !== normalizeCurrency(payment.currency) || !metadataMatches || !customerMatches || !subscriptionSnapshotMatches) {
    const reason = !amountMatches ? 'amount_mismatch'
      : currency !== normalizeCurrency(payment.currency) ? 'currency_mismatch'
        : !customerMatches ? 'customer_mismatch'
          : !metadataMatches ? 'provider_metadata_mismatch'
            : 'subscription_snapshot_mismatch';
    console.warn('Subscription payment verification mismatch', { paymentId: payment.id, reason });
    await markVerificationFailure({
      reason,
      providerStatus,
      resolvedTransactionId: providerTransactionId,
      metadata: {
        ...(currency !== normalizeCurrency(payment.currency) ? { providerCurrency: currency, expectedCurrency: payment.currency } : {}),
        ...(providerCustomerEmailNormalized && !customerMatches ? { customerEmailMismatch: true } : {}),
      },
    });
    throw new SeekerSubscriptionError('Flutterwave payment details did not match this subscription', 422);
  }

  return prisma.$transaction(async (transaction) => {
    const currentPayment = await transaction.payment.findUnique({ where: { id: payment.id }, select: { ...paymentSelect, subscription: { select: subscriptionSelect } } });
    if (!currentPayment) throw new SeekerSubscriptionError('Subscription payment record not found', 404);
    if (currentPayment.status === 'SUCCESSFUL') {
      const subscription = currentPayment.subscription ?? await transaction.subscription.findUnique({ where: { id: currentPayment.subscriptionId }, select: subscriptionSelect });
      return { payment: serializePayment(currentPayment), subscription: subscription ? serializeSubscription(subscription) : null, alreadyVerified: true };
    }
    if (currentPayment.status !== 'PENDING'
      || currentPayment.userId !== userId
      || currentPayment.subscriptionId !== subscription.id
      || currentPayment.subscription?.userId !== userId
      || currentPayment.subscription?.planId !== subscription.planId
      || currentPayment.providerReference !== payment.providerReference
      || !new Prisma.Decimal(String(currentPayment.amount)).eq(new Prisma.Decimal(String(payment.amount)))
      || normalizeCurrency(currentPayment.currency) !== normalizeCurrency(payment.currency)) {
      throw new SeekerSubscriptionError('Subscription payment state changed during verification', 409);
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
      const racedPayment = await transaction.payment.findUnique({
        where: { id: currentPayment.id },
        select: { ...paymentSelect, subscription: { select: subscriptionSelect } },
      });
      if (racedPayment?.status === 'SUCCESSFUL'
        && racedPayment.subscription?.status === 'ACTIVE'
        && racedPayment.userId === userId
        && racedPayment.subscription.userId === userId) {
        return { payment: serializePayment(racedPayment), subscription: serializeSubscription(racedPayment.subscription), alreadyVerified: true };
      }
      throw new SeekerSubscriptionError('This subscription is no longer pending', 409);
    }

    const updatedPayment = await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESSFUL',
        transactionId: providerTransactionId,
        verifiedAt: new Date(),
        metadata: { ...(currentPayment.metadata ?? {}), providerStatus, verifiedAt: new Date().toISOString() },
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

  const catalog = plans.map((plan) => ({
    id: plan.id,
    key: plan.key,
    displayName: plan.displayName,
    description: plan.description,
    price: plan.price ? plan.price.toString() : null,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    active: plan.isActive,
    public: plan.isPublic,
    aiAllowance: plan.aiAllowance ?? null,
    aiUnlimited: Boolean(plan.aiUnlimited),
    featureConfig: plan.featureConfig ?? {},
    benefits: Array.isArray(plan.benefits) ? plan.benefits : [],
    entitlements: (plan.entitlements ?? []).map(({ entitlement }) => entitlement.key),
  }));

  const hasBasic = catalog.some((plan) => plan.key === 'BASIC');
  if (!hasBasic) {
    catalog.unshift({
      id: 'basic-free-plan',
      key: 'BASIC',
      displayName: 'Basic',
      description: 'Free access with limited AI usage and core job features.',
      price: null,
      currency: null,
      billingInterval: 'MONTHLY',
      active: true,
      public: true,
      aiAllowance: 5,
      aiUnlimited: false,
      featureConfig: { free: true },
      benefits: ['Browse jobs', 'Search jobs', 'Basic filters', 'Limited AI credits'],
      entitlements: [],
    });
  }

  return catalog;
};

export const listSeekerSubscriptions = async (userId) => {
  await reconcileExpiredSubscriptionsForUser(userId);
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: subscriptionSelect,
  });
  const effectiveState = await resolveEffectiveEntitlements(userId);
  const aiUsage = await getAiUsageState(userId);
  const effectivePlan = effectiveState.effectivePlan;

  return {
    subscriptions: subscriptions.map((subscription) => serializeSubscription({ ...subscription, status: getEffectiveSubscriptionStatus(subscription) })),
    currentSubscription: subscriptions.find((subscription) => isCurrentSubscription(subscription)) ? serializeSubscription(subscriptions.find((subscription) => isCurrentSubscription(subscription))) : null,
    activeSubscription: subscriptions.find((subscription) => isCurrentSubscription(subscription)) ? serializeSubscription(subscriptions.find((subscription) => isCurrentSubscription(subscription))) : null,
    activeTrial: effectiveState.trial,
    aiUsage,
    currentPlan: effectivePlan ? {
      id: effectivePlan.id,
      key: effectiveState.planKey,
      displayName: effectivePlan.displayName,
      description: effectivePlan.description,
      price: effectivePlan.price ? effectivePlan.price.toString() : null,
      currency: effectivePlan.currency,
      billingInterval: effectivePlan.billingInterval,
      active: effectivePlan.isActive,
      public: effectivePlan.isPublic,
      aiAllowance: effectiveState.aiAllowance,
      aiUnlimited: effectiveState.aiUnlimited,
      featureConfig: effectivePlan.featureConfig ?? {},
      benefits: Array.isArray(effectivePlan.benefits) ? effectivePlan.benefits : [],
      entitlements: effectiveState.entitlements,
    } : {
      id: 'basic-free-plan',
      key: effectiveState.planKey,
      displayName: 'Basic',
      description: 'Free access with limited AI usage and core job features.',
      price: null,
      currency: null,
      billingInterval: 'MONTHLY',
      active: true,
      public: true,
      aiAllowance: effectiveState.aiAllowance,
      aiUnlimited: effectiveState.aiUnlimited,
      featureConfig: {},
      benefits: ['Browse jobs', 'Search jobs', 'Basic filters', 'Limited AI credits'],
      entitlements: effectiveState.entitlements,
    },
  };
};

export const getSeekerTrialOffer = async (userId) => {
  const settings = prisma.subscriptionSettings
    ? await prisma.subscriptionSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', trialEnabled: true, trialDurationDays: 7, trialPlanKey: 'PREMIUM' },
    })
    : { trialEnabled: true, trialDurationDays: 7, trialPlanKey: 'PREMIUM' };
  const activeTrial = await getActiveTrialForUser(userId);

  return {
    available: Boolean(settings.trialEnabled && !activeTrial),
    durationDays: settings.trialDurationDays,
    trialPlanKey: settings.trialPlanKey,
  };
};

export const startSeekerFreeTrial = async (userId) => startFreeTrial({ userId, source: 'SELF_SERVICE', description: 'Seeker self-service free trial' });
