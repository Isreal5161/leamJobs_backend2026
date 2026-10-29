import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { verifyPaystackTransaction } from './paystack.service.js';
import { verifySeekerSubscriptionPayment } from './seekerSubscription.service.js';
import { recordSubscriptionWebhookEvent } from './flutterwaveWebhook.service.js';

export class PaystackWebhookError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PaystackWebhookError';
    this.status = status;
  }
}

const recordCancelledSubscriptionPaymentForReview = async ({ payment, transactionId }) => {
  const providerPayment = await verifyPaystackTransaction(payment.providerReference);
  const returnedTransactionId = providerPayment?.id;
  const providerReference = providerPayment?.reference;
  const providerStatus = String(providerPayment?.status ?? '').trim().toLowerCase();
  const providerAmount = String(providerPayment?.amount ?? '');
  const providerCurrency = String(providerPayment?.currency ?? '').trim().toUpperCase();
  const metadata = providerPayment?.meta ?? providerPayment?.metadata;
  const storedMetadata = payment.metadata ?? {};
  const amountMatches = /^\d+$/.test(providerAmount)
    && new Prisma.Decimal(providerAmount).eq(new Prisma.Decimal(String(payment.amount)).mul(100));
  const metadataMatches = !metadata || typeof metadata !== 'object'
    || ['userId', 'planId', 'subscriptionId', 'planKey'].every((key) => (
      metadata[key] === undefined || !storedMetadata[key] || String(metadata[key]) === String(storedMetadata[key])
    ));
  const storedEmail = String(storedMetadata.customerEmail ?? '').trim().toLowerCase();
  const providerEmail = String(providerPayment?.customer?.email ?? '').trim().toLowerCase();
  if (String(returnedTransactionId ?? '') !== String(transactionId)
    || providerReference !== payment.providerReference
    || providerStatus !== 'success'
    || !amountMatches
    || providerCurrency !== String(payment.currency ?? '').trim().toUpperCase()
    || !metadataMatches
    || (storedEmail && providerEmail && storedEmail !== providerEmail)) {
    throw new PaystackWebhookError('Paystack payment could not be safely reconciled for manual review', 422);
  }

  const recorded = await prisma.$transaction(async (transaction) => {
    const currentPayment = await transaction.payment.findUnique({
      where: { id: payment.id },
      select: { status: true, metadata: true, subscription: { select: { status: true } } },
    });
    if (currentPayment?.status === 'SUCCESSFUL' && currentPayment.subscription?.status === 'CANCELLED') return true;
    if (currentPayment?.status !== 'CANCELLED' || currentPayment.subscription?.status !== 'CANCELLED') {
      throw new PaystackWebhookError('Subscription payment state changed during reconciliation', 409);
    }

    const updated = await transaction.payment.updateMany({
      where: { id: payment.id, status: 'CANCELLED' },
      data: {
        status: 'SUCCESSFUL',
        transactionId: String(transactionId),
        verifiedAt: new Date(),
        metadata: {
          ...(currentPayment.metadata ?? {}),
          providerStatus,
          manualReviewRequired: true,
          manualReviewReason: 'PAYMENT_CONFIRMED_AFTER_SUBSCRIPTION_CANCELLATION',
        },
      },
    });
    if (updated.count !== 1) throw new PaystackWebhookError('Subscription payment state changed during reconciliation', 409);
    return true;
  });

  return { payment: { status: recorded ? 'SUCCESSFUL' : null }, manualReviewRequired: true };
};

export const handlePaystackSubscriptionWebhook = async ({ payload }) => {
  if (payload?.event !== 'charge.success') return { ignored: true };
  const providerReference = payload?.data?.reference;
  const transactionId = payload?.data?.id;
  if (typeof providerReference !== 'string' || !providerReference.trim()
    || transactionId === undefined || !/^\d+$/.test(String(transactionId))) {
    throw new PaystackWebhookError('Incomplete Paystack subscription webhook payload');
  }

  const payment = await prisma.payment.findUnique({
    where: { providerReference },
    select: {
      id: true,
      userId: true,
      provider: true,
      paymentType: true,
      providerReference: true,
      transactionId: true,
      subscriptionId: true,
      status: true,
      amount: true,
      currency: true,
      metadata: true,
      subscription: { select: { status: true } },
    },
  });
  if (!payment || payment.provider !== 'PAYSTACK'
    || payment.paymentType !== 'SUBSCRIPTION'
    || !payment.subscriptionId) {
    throw new PaystackWebhookError('Paystack subscription payment record not found', 404);
  }
  if (payment.transactionId && String(payment.transactionId) !== String(transactionId)) {
    throw new PaystackWebhookError('Paystack transaction ID does not match the subscription payment', 422);
  }
  if (payment.status === 'CANCELLED' && payment.subscription?.status === 'CANCELLED') {
    return recordSubscriptionWebhookEvent({
      provider: 'PAYSTACK',
      payload,
      payment,
      transactionId: String(transactionId),
      processPayment: () => recordCancelledSubscriptionPaymentForReview({ payment, transactionId: String(transactionId) }),
    });
  }

  return recordSubscriptionWebhookEvent({
    provider: 'PAYSTACK',
    payload,
    payment,
    transactionId: String(transactionId),
    processPayment: () => verifySeekerSubscriptionPayment({
      userId: payment.userId,
      providerReference: payment.providerReference,
      transactionId: String(transactionId),
      returnProviderFailure: true,
    }),
  });
};
