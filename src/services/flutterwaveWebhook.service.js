import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { handleFlutterwaveWebhook as handleContractFlutterwaveWebhook } from './contractPayment.service.js';
import { verifySeekerSubscriptionPayment } from './seekerSubscription.service.js';

export class FlutterwaveWebhookError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'FlutterwaveWebhookError';
    this.status = status;
  }
}

const webhookPaymentSelect = {
  id: true,
  userId: true,
  subscriptionId: true,
  providerReference: true,
  transactionId: true,
  paymentType: true,
  provider: true,
};

const resolveWebhookPayment = async ({ providerReference, transactionId }) => {
  const byReference = providerReference
    ? await prisma.payment.findUnique({ where: { providerReference }, select: webhookPaymentSelect })
    : null;
  const byTransactionId = transactionId
    ? await prisma.payment.findUnique({ where: { transactionId: String(transactionId) }, select: webhookPaymentSelect })
    : null;

  if (byReference && byTransactionId && byReference.id !== byTransactionId.id) {
    throw new FlutterwaveWebhookError('Flutterwave transaction identifiers do not match the same payment', 409);
  }
  return byReference ?? byTransactionId;
};

export const handleFlutterwaveWebhook = async ({ payload }) => {
  const data = payload?.data;
  const providerReference = data?.tx_ref || data?.reference;
  const transactionIdValue = data?.id ?? data?.transaction_id;
  const transactionId = transactionIdValue === undefined || transactionIdValue === null
    ? null
    : String(transactionIdValue);

  const payment = await resolveWebhookPayment({ providerReference, transactionId });
  if (payment?.provider === 'FLUTTERWAVE' && payment.paymentType === 'SUBSCRIPTION') {
    return handleSeekerSubscriptionWebhook({
      payload,
      providerReference: payment.providerReference,
      transactionId: transactionId ?? payment.transactionId,
    });
  }

  return handleContractFlutterwaveWebhook({ payload });
};

const getSubscriptionWebhookEventId = ({ payload, transactionId, eventType, providerStatus }) => {
  const providerEventId = payload?.id;
  const eventIdentity = providerEventId === undefined || providerEventId === null || String(providerEventId).trim() === ''
    ? transactionId
    : String(providerEventId);
  if (!eventIdentity) return null;
  return `${eventIdentity}:${eventType || 'charge'}:${providerStatus || 'unknown'}`;
};

export const recordSubscriptionWebhookEvent = async ({ payload, payment, transactionId, processPayment }) => {
  const providerStatus = String(payload?.data?.status ?? payload?.status ?? '').trim().toLowerCase();
  const eventType = String(payload?.event ?? '').trim();
  const providerEventId = getSubscriptionWebhookEventId({ payload, transactionId, eventType, providerStatus });
  if (!providerEventId) {
    throw new FlutterwaveWebhookError('Flutterwave webhook event could not be identified', 400);
  }

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const eventWhere = { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId } };
  let existingEvent;

  try {
    await prisma.providerWebhookEvent.create({
      data: {
        provider: 'FLUTTERWAVE',
        providerEventId,
        eventType: eventType || null,
        payloadHash,
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    existingEvent = await prisma.providerWebhookEvent.findUnique({
      where: eventWhere,
      select: { payloadHash: true, processedAt: true },
    });
    if (!existingEvent) throw error;
    if (existingEvent.payloadHash !== payloadHash) {
      throw new FlutterwaveWebhookError('Flutterwave reused a webhook event identifier with different content', 409);
    }
    if (existingEvent.processedAt) return { duplicate: true };
  }

  const result = await processPayment();
  await prisma.providerWebhookEvent.update({
    where: eventWhere,
    data: { processedAt: new Date() },
  });
  return {
    duplicate: false,
    paymentId: payment.id,
    status: result.failed ? 'FAILED' : result.pending ? 'PENDING' : result.payment?.status ?? null,
  };
};

const handleSeekerSubscriptionWebhook = async ({ payload, providerReference, transactionId }) => {
  if (!providerReference) {
    throw new FlutterwaveWebhookError('Flutterwave subscription payment reference is required', 400);
  }
  if (!transactionId || !/^[0-9]+$/.test(String(transactionId))) {
    throw new FlutterwaveWebhookError('A valid Flutterwave transaction ID is required', 400);
  }

  const payment = await prisma.payment.findUnique({
    where: { providerReference },
    select: webhookPaymentSelect,
  });
  if (!payment || payment.provider !== 'FLUTTERWAVE' || payment.paymentType !== 'SUBSCRIPTION' || !payment.subscriptionId) {
    throw new FlutterwaveWebhookError('Subscription payment record not found', 404);
  }

  const payloadReference = payload?.data?.tx_ref || payload?.data?.reference;
  if (payloadReference && payloadReference !== payment.providerReference) {
    throw new FlutterwaveWebhookError('Flutterwave transaction reference does not match the subscription payment', 422);
  }
  if (payment.transactionId && String(payment.transactionId) !== String(transactionId)) {
    throw new FlutterwaveWebhookError('Flutterwave transaction ID does not match the subscription payment', 422);
  }

  return recordSubscriptionWebhookEvent({
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
