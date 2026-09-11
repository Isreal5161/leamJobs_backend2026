import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { initializeFlutterwavePayment, verifyFlutterwaveTransaction } from './flutterwave.service.js';
import { contractSelect, ContractNotFoundError, mapContract } from './contract.service.js';

export class ContractPaymentError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'ContractPaymentError';
    this.status = status;
  }
}

const paymentSelect = {
  id: true,
  escrowId: true,
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

const paymentResponse = (payment) => ({
  id: payment.id,
  providerReference: payment.providerReference,
  transactionId: payment.transactionId,
  amount: payment.amount.toFixed(2),
  currency: payment.currency,
  status: payment.status,
  paymentType: payment.paymentType,
  provider: payment.provider,
  checkoutUrl: payment.metadata?.checkoutUrl ?? null,
  verifiedAt: payment.verifiedAt,
  createdAt: payment.createdAt,
});

const lockPaymentContract = async (transaction, contractId) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Contract"
    WHERE "id" = ${contractId}
    FOR UPDATE
  `;
  return transaction.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      status: true,
      employerId: true,
      employer: { select: { email: true } },
      freelanceDetails: {
        select: {
          agreedAmount: true,
          currency: true,
          escrow: {
            select: {
              id: true,
              status: true,
              grossAmount: true,
              payments: {
                where: { paymentType: 'CONTRACT_FUNDING' },
                orderBy: { createdAt: 'desc' },
                select: paymentSelect,
              },
            },
          },
        },
      },
    },
  });
};

const assertPaymentContract = (contract, employerId) => {
  if (!contract || contract.employerId !== employerId) throw new ContractNotFoundError();
  if (contract.status !== 'ACTIVE') throw new ContractPaymentError('Only active contracts can be funded');
  if (!contract.freelanceDetails?.escrow) throw new ContractPaymentError('The contract escrow is unavailable', 422);
  if (!['UNFUNDED', 'FUNDING'].includes(contract.freelanceDetails.escrow.status)) {
    throw new ContractPaymentError('This contract escrow is already funded');
  }
  if (!contract.freelanceDetails.agreedAmount || new Prisma.Decimal(contract.freelanceDetails.agreedAmount).lte(0)) {
    throw new ContractPaymentError('The contract amount is invalid', 422);
  }
  if (!/^[A-Z]{3}$/.test(contract.freelanceDetails.currency)) {
    throw new ContractPaymentError('The contract currency is invalid', 422);
  }
};

const findExistingAttempt = (payments, idempotencyKey) => payments.find((payment) => (
  payment.idempotencyKey === idempotencyKey
  || ['PENDING', 'PROCESSING', 'SUCCESSFUL'].includes(payment.status)
));

export const initializeContractPayment = async ({ contractId, employerId, idempotencyKey }) => {
  const requestedKey = idempotencyKey?.trim();
  if (requestedKey && requestedKey.length > 100) throw new ContractPaymentError('Idempotency key is too long', 400);

  const attempt = await prisma.$transaction(async (transaction) => {
    const contract = await lockPaymentContract(transaction, contractId);
    assertPaymentContract(contract, employerId);
    const existing = findExistingAttempt(contract.freelanceDetails.escrow.payments, requestedKey);
    if (existing?.status === 'SUCCESSFUL') return { alreadyFunded: true, payment: existing };
    if (existing) return { alreadyFunded: false, payment: existing };

    const providerReference = `leamjobs_${contractId}_${crypto.randomUUID()}`;
    const payment = await transaction.payment.create({
      data: {
        userId: employerId,
        escrowId: contract.freelanceDetails.escrow.id,
        providerReference,
        idempotencyKey: requestedKey || `contract:${contractId}:${crypto.randomUUID()}`,
        amount: new Prisma.Decimal(contract.freelanceDetails.agreedAmount),
        currency: contract.freelanceDetails.currency,
        status: 'PENDING',
        paymentType: 'CONTRACT_FUNDING',
        provider: 'FLUTTERWAVE',
        metadata: { contractId, checkoutUrl: null },
      },
      select: paymentSelect,
    });
    return { alreadyFunded: false, payment, email: contract.employer.email, amount: contract.freelanceDetails.agreedAmount, currency: contract.freelanceDetails.currency };
  });

  if (attempt.alreadyFunded) {
    return { alreadyFunded: Boolean(attempt.alreadyFunded), payment: paymentResponse(attempt.payment) };
  }
  if (!attempt.email) throw new ContractPaymentError('Employer email is required to start payment', 422);
  if (attempt.payment.metadata?.checkoutUrl) return { alreadyFunded: false, payment: paymentResponse(attempt.payment) };

  try {
    const checkout = await initializeFlutterwavePayment({
      amount: new Prisma.Decimal(attempt.amount).toFixed(2),
      currency: attempt.currency,
      email: attempt.email,
      txRef: attempt.payment.providerReference,
      meta: { contractId },
      redirectUrl: `${env.FRONTEND_URL}/employer/contracts/${contractId}`,
    });
    const updated = await prisma.payment.update({
      where: { id: attempt.payment.id },
      data: { metadata: { contractId, checkoutUrl: checkout.checkoutUrl } },
      select: paymentSelect,
    });
    return { alreadyFunded: false, payment: paymentResponse(updated) };
  } catch (error) {
    await prisma.payment.update({
      where: { id: attempt.payment.id },
      data: { status: 'FAILED', metadata: { contractId, failure: error.message } },
    }).catch(() => undefined);
    throw error;
  }
};

const markPaymentFailed = async (paymentId, metadata) => prisma.payment.update({
  where: { id: paymentId },
  data: { status: 'FAILED', metadata },
});

const validateProviderPayment = (providerPayment, payment) => {
  const providerReference = providerPayment.tx_ref || providerPayment.reference;
  const amountMatches = new Prisma.Decimal(providerPayment.amount ?? 0).eq(payment.amount);
  const currencyMatches = String(providerPayment.currency || '').toUpperCase() === payment.currency;
  const referenceMatches = providerReference === payment.providerReference;
  if (providerPayment.status !== 'successful' || !amountMatches || !currencyMatches || !referenceMatches) {
    throw new ContractPaymentError('Flutterwave payment verification failed', 422);
  }
};

const findPaymentForVerification = async ({ contractId, employerId, providerReference }) => {
  if (!contractId) {
    if (!providerReference) throw new ContractNotFoundError();
    const payment = await prisma.payment.findUnique({
      where: { providerReference },
      select: {
        ...paymentSelect,
        escrow: { select: { freelanceContract: { select: { contract: { select: { id: true, employerId: true } } } } } },
      },
    });
    const resolvedContract = payment?.escrow?.freelanceContract?.contract;
    if (!payment || !resolvedContract || (employerId && resolvedContract.employerId !== employerId)) throw new ContractNotFoundError();
    const fullContract = await prisma.contract.findUnique({ where: { id: resolvedContract.id }, select: contractSelect });
    return { contract: fullContract, payment };
  }

  const contract = await prisma.contract.findFirst({
    where: { ...(contractId ? { id: contractId } : {}), ...(employerId ? { employerId } : {}) },
    select: {
      id: true,
      employerId: true,
      freelanceDetails: { select: { escrow: { select: { id: true, payments: { where: { paymentType: 'CONTRACT_FUNDING' }, orderBy: { createdAt: 'desc' }, select: paymentSelect } } } } },
    },
  });
  if (!contract?.freelanceDetails?.escrow) throw new ContractNotFoundError();
  const payment = providerReference
    ? contract.freelanceDetails.escrow.payments.find((item) => item.providerReference === providerReference)
    : contract.freelanceDetails.escrow.payments.find((item) => ['PENDING', 'PROCESSING'].includes(item.status));
  if (!payment) throw new ContractPaymentError('Payment attempt not found', 404);
  return { contract, payment };
};

export const verifyContractPayment = async ({ contractId, employerId, providerReference, transactionId }) => {
  const { contract, payment } = await findPaymentForVerification({ contractId, employerId, providerReference });
  const resolvedContractId = contractId || contract.id;
  if (payment.status === 'SUCCESSFUL') return { payment: paymentResponse(payment), contract: await getContractForPayment(resolvedContractId, employerId) };
  const providerPayment = await verifyFlutterwaveTransaction(transactionId);
  try {
    validateProviderPayment(providerPayment, payment);
  } catch (error) {
    await markPaymentFailed(payment.id, { contractId, verificationFailure: error.message, providerTransactionId: String(transactionId) });
    throw error;
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Escrow"
      WHERE "id" = ${payment.escrowId}
      FOR UPDATE
    `;
    const locked = await transaction.payment.findUnique({ where: { id: payment.id }, select: { ...paymentSelect, escrowId: true } });
    const escrow = await transaction.escrow.findUnique({ where: { id: payment.escrowId }, select: { id: true, status: true, grossAmount: true } });
    if (!locked || !escrow) throw new ContractPaymentError('Payment escrow is unavailable', 422);
    if (locked.status === 'SUCCESSFUL' || escrow.status === 'FUNDED') {
      return { payment: paymentResponse(locked), contract: await getContractForPayment(resolvedContractId, employerId, transaction) };
    }
    if (!['UNFUNDED', 'FUNDING'].includes(escrow.status) || !new Prisma.Decimal(locked.amount).eq(escrow.grossAmount)) {
      throw new ContractPaymentError('The payment does not match the contract escrow', 422);
    }
    const updatedPayment = await transaction.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESSFUL', transactionId: String(providerPayment.id), verifiedAt: new Date(), metadata: { ...(locked.metadata ?? {}), providerStatus: providerPayment.status } },
      select: paymentSelect,
    });
    await transaction.escrow.update({
      where: { id: escrow.id },
      data: { status: 'FUNDED', fundedAmount: new Prisma.Decimal(escrow.grossAmount), fundedAt: new Date() },
    });
    return { payment: paymentResponse(updatedPayment), contract: await getContractForPayment(resolvedContractId, employerId, transaction) };
  });
};

const getContractForPayment = async (contractId, employerId, transaction = prisma) => {
  const contract = await transaction.contract.findFirst({
    where: { id: contractId, employerId },
    select: contractSelect,
  });
  if (!contract) throw new ContractNotFoundError();
  return mapContract(contract);
};

export const handleFlutterwaveWebhook = async ({ payload }) => {
  const eventId = payload?.id ?? payload?.data?.id;
  const providerReference = payload?.data?.tx_ref || payload?.data?.reference;
  const transactionId = payload?.data?.id;
  if (!eventId || !providerReference || !transactionId) throw new ContractPaymentError('Incomplete Flutterwave webhook payload', 400);
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  try {
    await prisma.providerWebhookEvent.create({ data: { provider: 'FLUTTERWAVE', providerEventId: String(eventId), eventType: payload.event || null, payloadHash } });
  } catch (error) {
    if (error?.code === 'P2002') return { duplicate: true };
    throw error;
  }
  try {
    const result = await verifyContractPayment({ providerReference, transactionId, contractId: payload?.data?.meta?.contractId });
    await prisma.providerWebhookEvent.update({ where: { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId: String(eventId) } }, data: { processedAt: new Date() } });
    return { duplicate: false, result };
  } catch (error) {
    if (error.status && error.status < 500) {
      await prisma.providerWebhookEvent.update({ where: { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId: String(eventId) } }, data: { processedAt: new Date() } });
    } else {
      await prisma.providerWebhookEvent.delete({ where: { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId: String(eventId) } } }).catch(() => undefined);
    }
    throw error;
  }
};