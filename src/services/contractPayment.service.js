import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { initializeFlutterwavePayment, verifyFlutterwaveTransaction } from './flutterwave.service.js';
import { initializePaystackPayment, isPaystackConfigured, verifyPaystackTransaction } from './paystack.service.js';
import { contractSelect, ContractNotFoundError, mapContract } from './contract.service.js';
import { createNotification } from './notification.service.js';
import { assertCollectionCurrencyEnabled } from '../config/walletCurrencies.js';
import { assertFreelancePaymentFeatureEnabled } from '../config/freelancePaymentFeatures.js';
import { initializeSeekerWallet } from './wallet.service.js';

export class ContractPaymentError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'ContractPaymentError';
    this.status = status;
  }
}

const paymentSelect = {
  id: true,
  userId: true,
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

const MAX_PAYMENT_AMOUNT = new Prisma.Decimal('9999999999.99');
const INITIALIZATION_CLAIM_KEY = 'checkoutInitialization';
const MAX_WEBHOOK_ATTEMPTS = 6;
const WEBHOOK_LEASE_MS = 15 * 60 * 1000;
const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

// Legacy snapshots store a lower seeker net; zero-fee rows are equivalent under either model.
const isAdditiveFundingSnapshot = (details) => (
  new Prisma.Decimal(details.seekerNetAmount).eq(details.agreedAmount)
);

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
      applicationId: true,
      seekerId: true,
      type: true,
      status: true,
      employerId: true,
      employer: { select: { email: true } },
      freelanceDetails: {
        select: {
          agreedAmount: true,
          currency: true,
          platformFeePercentage: true,
          platformFeeAmount: true,
          seekerNetAmount: true,
          escrow: {
            select: {
              id: true,
              status: true,
              grossAmount: true,
              platformFeeAmount: true,
              seekerNetAmount: true,
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
  if (contract.type === 'CONTRACT_PROJECT') {
    if (contract.status !== 'PENDING') throw new ContractPaymentError('This Contract Job is not awaiting payment');
  } else if (contract.type === 'FREELANCE_PROJECT') {
    if (!['PENDING', 'ACTIVE'].includes(contract.status)) {
      throw new ContractPaymentError('This freelance project is not eligible for funding');
    }
  } else {
    throw new ContractPaymentError('This contract type cannot be funded');
  }
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
  const details = contract.freelanceDetails;
  if ([details.platformFeePercentage, details.platformFeeAmount, details.seekerNetAmount].some((value) => value === null || value === undefined)) {
    throw new ContractPaymentError('The contract funding terms are unavailable', 422);
  }
  const projectAmount = new Prisma.Decimal(details.agreedAmount);
  const percentage = new Prisma.Decimal(details.platformFeePercentage);
  const fee = new Prisma.Decimal(details.platformFeeAmount);
  const expectedFee = projectAmount.mul(percentage).dividedBy(100).toDecimalPlaces(2);
  if (percentage.lt(0) || percentage.gt(100) || fee.lt(0) || !fee.eq(expectedFee)) {
    throw new ContractPaymentError('The contract funding fee snapshot is invalid', 422);
  }
  if (!new Prisma.Decimal(details.seekerNetAmount).eq(projectAmount)
    && !new Prisma.Decimal(details.seekerNetAmount).eq(projectAmount.minus(fee).toDecimalPlaces(2))) {
    throw new ContractPaymentError('The contract seeker entitlement snapshot is invalid', 422);
  }
  const escrow = details.escrow;
  if (!new Prisma.Decimal(escrow.grossAmount).eq(projectAmount)
    || !new Prisma.Decimal(escrow.platformFeeAmount).eq(fee)
    || !new Prisma.Decimal(escrow.seekerNetAmount).eq(details.seekerNetAmount)) {
    throw new ContractPaymentError('The contract escrow funding snapshot is invalid', 422);
  }
};

const fundingPaymentAmount = (details) => {
  const projectAmount = new Prisma.Decimal(details.agreedAmount);
  const fee = new Prisma.Decimal(details.platformFeeAmount);
  return isAdditiveFundingSnapshot(details) ? projectAmount.plus(fee) : projectAmount;
};

const fundingBreakdown = (details, paymentAmount) => ({
  projectAmount: new Prisma.Decimal(details.agreedAmount).toFixed(2),
  fundingPercentage: new Prisma.Decimal(details.platformFeePercentage).toFixed(2),
  fundingCharge: new Prisma.Decimal(details.platformFeeAmount).toFixed(2),
  totalEmployerPayment: new Prisma.Decimal(paymentAmount).toFixed(2),
  seekerEntitlement: new Prisma.Decimal(details.seekerNetAmount).toFixed(2),
  currency: details.currency,
});

const findExistingAttempt = (payments, idempotencyKey) => payments.find((payment) => (
  payment.idempotencyKey === idempotencyKey
  || ['PENDING', 'PROCESSING', 'SUCCESSFUL'].includes(payment.status)
));

const assertPaystackCollectionAvailable = (currency) => {
  if (!env.PAYSTACK_COLLECTION_ENABLED || !isPaystackConfigured() || !env.PAYSTACK_CONTRACT_CALLBACK_URL) {
    throw new ContractPaymentError('Paystack contract funding is not enabled or fully configured', 503);
  }
  if (currency !== 'NGN') {
    throw new ContractPaymentError('Paystack contract funding currently supports NGN only', 422);
  }
};

export const initializeContractPayment = async ({ contractId, employerId, idempotencyKey, redirectPath }) => {
  assertFreelancePaymentFeatureEnabled('contractFundingEnabled');
  const requestedKey = idempotencyKey?.trim();
  if (requestedKey && requestedKey.length > 100) throw new ContractPaymentError('Idempotency key is too long', 400);
  const initializationToken = crypto.randomUUID();

  const attempt = await prisma.$transaction(async (transaction) => {
    const contract = await lockPaymentContract(transaction, contractId);
    assertPaymentContract(contract, employerId);
    assertCollectionCurrencyEnabled(contract.freelanceDetails.currency);
    const existing = findExistingAttempt(contract.freelanceDetails.escrow.payments, requestedKey);
    const provider = existing?.provider ?? 'FLUTTERWAVE';
    if (existing?.status === 'SUCCESSFUL') {
      return {
        alreadyFunded: true,
        payment: existing,
        fundingBreakdown: fundingBreakdown(contract.freelanceDetails, existing.amount),
      };
    }
    const totalAmount = existing ? new Prisma.Decimal(existing.amount) : fundingPaymentAmount(contract.freelanceDetails);
    if (totalAmount.gt(MAX_PAYMENT_AMOUNT)) throw new ContractPaymentError('The total funding amount exceeds the supported limit', 422);

    if (existing) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Payment"
        WHERE "id" = ${existing.id}
        FOR UPDATE
      `;
      const lockedPayment = await transaction.payment.findUnique({ where: { id: existing.id }, select: paymentSelect });
      if (lockedPayment?.status !== 'FAILED'
        && (lockedPayment?.metadata?.checkoutUrl || lockedPayment?.metadata?.[INITIALIZATION_CLAIM_KEY])) {
        return {
          alreadyFunded: false,
          payment: lockedPayment,
          fundingBreakdown: fundingBreakdown(contract.freelanceDetails, lockedPayment.amount),
        };
      }
      if (lockedPayment?.provider === 'PAYSTACK') {
        assertPaystackCollectionAvailable(contract.freelanceDetails.currency);
      }
      const metadata = { ...(lockedPayment?.metadata ?? {}) };
      if (lockedPayment?.status === 'FAILED') delete metadata.checkoutUrl;
      const payment = await transaction.payment.update({
        where: { id: existing.id },
        data: {
          ...(lockedPayment?.status === 'FAILED' ? { status: 'PENDING' } : {}),
          metadata: {
            ...metadata,
            projectAmount: new Prisma.Decimal(contract.freelanceDetails.agreedAmount).toFixed(2),
            platformFeeAmount: new Prisma.Decimal(contract.freelanceDetails.platformFeeAmount).toFixed(2),
            fundingModel: isAdditiveFundingSnapshot(contract.freelanceDetails) ? 'ADDITIVE' : 'LEGACY_DEDUCTED',
            [INITIALIZATION_CLAIM_KEY]: initializationToken,
          },
        },
        select: paymentSelect,
      });
      return {
        alreadyFunded: false,
        provider: lockedPayment.provider,
        payment,
        initializationToken,
        email: contract.employer.email,
        amount: payment.amount,
        currency: payment.currency,
        fundingBreakdown: fundingBreakdown(contract.freelanceDetails, payment.amount),
      };
    }

    if (provider === 'PAYSTACK') {
      assertPaystackCollectionAvailable(contract.freelanceDetails.currency);
    }
    await initializeSeekerWallet(transaction, contract.seekerId, contract.freelanceDetails.currency);
    const providerReference = `leamjobs_${contractId}_${crypto.randomUUID()}`;
    const payment = await transaction.payment.create({
      data: {
        userId: employerId,
        escrowId: contract.freelanceDetails.escrow.id,
        providerReference,
        idempotencyKey: requestedKey || `contract:${contractId}:${crypto.randomUUID()}`,
        amount: totalAmount,
        currency: contract.freelanceDetails.currency,
        status: 'PENDING',
        paymentType: 'CONTRACT_FUNDING',
        provider,
        metadata: {
          contractId,
          returnPath: redirectPath || `/employer/contracts/${encodeURIComponent(contractId)}`,
          projectAmount: new Prisma.Decimal(contract.freelanceDetails.agreedAmount).toFixed(2),
          platformFeeAmount: new Prisma.Decimal(contract.freelanceDetails.platformFeeAmount).toFixed(2),
          fundingModel: isAdditiveFundingSnapshot(contract.freelanceDetails) ? 'ADDITIVE' : 'LEGACY_DEDUCTED',
          [INITIALIZATION_CLAIM_KEY]: initializationToken,
        },
      },
      select: paymentSelect,
    });
    return {
      alreadyFunded: false,
      provider,
      payment,
      initializationToken,
      email: contract.employer.email,
      amount: totalAmount,
      currency: contract.freelanceDetails.currency,
      fundingBreakdown: fundingBreakdown(contract.freelanceDetails, totalAmount),
    };
  });

  if (attempt.alreadyFunded) {
    return {
      alreadyFunded: Boolean(attempt.alreadyFunded),
      payment: paymentResponse(attempt.payment),
      fundingBreakdown: attempt.fundingBreakdown,
    };
  }
  if (attempt.payment.metadata?.checkoutUrl || !attempt.initializationToken) {
    return {
      alreadyFunded: false,
      payment: paymentResponse(attempt.payment),
      fundingBreakdown: attempt.fundingBreakdown,
    };
  }
  if (!attempt.email) {
    await releaseInitializationClaim(attempt.payment.id, attempt.initializationToken);
    throw new ContractPaymentError('Employer email is required to start payment', 422);
  }

  let checkoutCreated = false;
  try {
    const amount = new Prisma.Decimal(attempt.amount).toFixed(2);
    const checkout = attempt.provider === 'PAYSTACK'
      ? await initializePaystackPayment({
        amount,
        currency: attempt.currency,
        email: attempt.email,
        reference: attempt.payment.providerReference,
        callbackUrl: env.PAYSTACK_CONTRACT_CALLBACK_URL,
        metadata: {
          contractId,
          paymentId: attempt.payment.id,
          returnPath: redirectPath || `/employer/contracts/${encodeURIComponent(contractId)}`,
        },
      })
      : await initializeFlutterwavePayment({
        amount,
        currency: attempt.currency,
        email: attempt.email,
        txRef: attempt.payment.providerReference,
        meta: {
          contractId,
          projectAmount: attempt.payment.metadata?.projectAmount ?? amount,
          platformFeeAmount: attempt.payment.metadata?.platformFeeAmount ?? '0.00',
        },
        redirectUrl: `${env.FRONTEND_URL}${redirectPath || `/employer/contracts/${encodeURIComponent(contractId)}`}`,
      });
    if (checkout.providerReference !== attempt.payment.providerReference) {
      const referenceError = new ContractPaymentError('Payment provider returned an unexpected reference', 502);
      referenceError.outcomeUnknown = true;
      throw referenceError;
    }
    checkoutCreated = true;
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Payment"
        WHERE "id" = ${attempt.payment.id}
        FOR UPDATE
      `;
      const current = await transaction.payment.findUnique({ where: { id: attempt.payment.id }, select: paymentSelect });
      if (!current || current.metadata?.[INITIALIZATION_CLAIM_KEY] !== attempt.initializationToken) return current;
      return transaction.payment.update({
        where: { id: attempt.payment.id },
        data: {
          metadata: {
            ...(current.metadata ?? {}),
            checkoutUrl: checkout.checkoutUrl,
            [INITIALIZATION_CLAIM_KEY]: null,
          },
        },
        select: paymentSelect,
      });
    });
    return {
      alreadyFunded: false,
      payment: paymentResponse(updated ?? attempt.payment),
      fundingBreakdown: attempt.fundingBreakdown,
    };
  } catch (error) {
    if (!checkoutCreated && !error.outcomeUnknown) {
      await releaseInitializationClaim(attempt.payment.id, attempt.initializationToken);
    }
    throw error;
  }
};

const releaseInitializationClaim = async (paymentId, token) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Payment"
    WHERE "id" = ${paymentId}
    FOR UPDATE
  `;
  const current = await transaction.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
  if (!current || current.metadata?.[INITIALIZATION_CLAIM_KEY] !== token) return;
  const metadata = { ...(current.metadata ?? {}) };
  delete metadata[INITIALIZATION_CLAIM_KEY];
  await transaction.payment.update({ where: { id: paymentId }, data: { metadata }, select: paymentSelect });
});

const validateProviderPayment = (providerPayment, payment, transactionId) => {
  const isPaystack = payment.provider === 'PAYSTACK';
  const providerReference = isPaystack ? providerPayment.reference : (providerPayment.tx_ref || providerPayment.reference);
  const providerTransactionId = String(providerPayment.id ?? '');
  const referenceMatches = providerReference === payment.providerReference;
  const transactionMatches = isPaystack
    ? /^\d+$/.test(providerTransactionId) && (!/^\d+$/.test(String(transactionId ?? '')) || providerTransactionId === String(transactionId))
    : providerTransactionId === String(transactionId);
  const amountMatches = isPaystack
    ? Number.isInteger(Number(providerPayment.amount))
      && new Prisma.Decimal(providerPayment.amount ?? 0).eq(new Prisma.Decimal(payment.amount).mul(100))
    : new Prisma.Decimal(providerPayment.amount ?? 0).eq(payment.amount);
  const currencyMatches = String(providerPayment.currency || '').toUpperCase() === String(payment.currency || '').toUpperCase();
  if (!referenceMatches || !transactionMatches || !amountMatches || !currencyMatches) {
    throw new ContractPaymentError(`${payment.provider} payment verification failed`, 422);
  }
  const status = String(providerPayment.status ?? '').toLowerCase();
  const paymentStatus = isPaystack
    ? status === 'success'
      ? 'SUCCESSFUL'
      : ['failed', 'abandoned'].includes(status)
        ? 'FAILED'
        : 'PROCESSING'
    : status === 'successful'
      ? 'SUCCESSFUL'
      : ['failed', 'cancelled', 'canceled'].includes(status)
        ? 'FAILED'
        : 'PROCESSING';
  return { status: paymentStatus, transactionId: providerTransactionId };
};

const assertContractFundingPayment = (payment, contract, escrow) => {
  if (
    !['FLUTTERWAVE', 'PAYSTACK'].includes(payment.provider)
    || payment.paymentType !== 'CONTRACT_FUNDING'
    || payment.userId !== contract.employerId
    || payment.escrowId !== escrow.id
  ) {
    throw new ContractPaymentError('Payment is not consistently associated with its contract escrow', 409);
  }
  const paymentCurrency = String(payment.currency || '').toUpperCase();
  const escrowCurrency = String(escrow.currency || '').toUpperCase();
  const contractCurrency = String(contract.freelanceDetails?.currency || '').toUpperCase();
  if (!paymentCurrency || paymentCurrency !== escrowCurrency || paymentCurrency !== contractCurrency) {
    throw new ContractPaymentError('Payment currency does not match its contract escrow', 409);
  }
};

const assertWebhookClaim = async (transaction, webhookClaim) => {
  if (!webhookClaim) return;
  const rows = await transaction.$queryRaw`
    SELECT "id"
    FROM "ProviderWebhookEvent"
    WHERE "id" = ${webhookClaim.id}
      AND "claimToken" = ${webhookClaim.token}
      AND "processedAt" IS NULL
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new ContractPaymentError('Webhook recovery claim expired; retry reconciliation', 503);
};

const transitionPaymentStatus = async (payment, status, metadata, webhookClaim = null) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Escrow"
    WHERE "id" = ${payment.escrowId}
    FOR UPDATE
  `;
  await assertWebhookClaim(transaction, webhookClaim);
  const [current, escrow] = await Promise.all([
    transaction.payment.findUnique({ where: { id: payment.id }, select: paymentSelect }),
    transaction.escrow.findUnique({ where: { id: payment.escrowId }, select: { id: true, status: true } }),
  ]);
  if (!current || !escrow) throw new ContractPaymentError('Payment escrow is unavailable', 422);
  if (current.status === 'SUCCESSFUL' || escrow.status === 'FUNDED') return current;
  if (!['PENDING', 'PROCESSING'].includes(current.status) || !['UNFUNDED', 'FUNDING'].includes(escrow.status)) return current;
  return transaction.payment.update({
    where: { id: payment.id },
    data: { status, metadata },
    select: paymentSelect,
  });
});

const findPaymentForVerification = async ({ contractId, employerId, providerReference }) => {
  if (!contractId) {
    if (!providerReference) throw new ContractNotFoundError();
    const payment = await prisma.payment.findUnique({
      where: { providerReference },
      select: {
        ...paymentSelect,
        escrow: {
          select: {
            id: true,
            currency: true,
            freelanceContract: {
              select: {
                contract: {
                  select: {
                    id: true,
                    employerId: true,
                    freelanceDetails: { select: { currency: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const resolvedContract = payment?.escrow?.freelanceContract?.contract;
    if (!payment || !resolvedContract || (employerId && resolvedContract.employerId !== employerId)) throw new ContractNotFoundError();
    assertContractFundingPayment(payment, resolvedContract, payment.escrow);
    const fullContract = await prisma.contract.findUnique({ where: { id: resolvedContract.id }, select: contractSelect });
    return { contract: fullContract, payment };
  }

  const contract = await prisma.contract.findFirst({
    where: { ...(contractId ? { id: contractId } : {}), ...(employerId ? { employerId } : {}) },
    select: {
      id: true,
      employerId: true,
      freelanceDetails: {
        select: {
          currency: true,
          escrow: {
            select: {
              id: true,
              currency: true,
              payments: { where: { paymentType: 'CONTRACT_FUNDING' }, orderBy: { createdAt: 'desc' }, select: paymentSelect },
            },
          },
        },
      },
    },
  });
  if (!contract?.freelanceDetails?.escrow) throw new ContractNotFoundError();
  const payment = providerReference
    ? contract.freelanceDetails.escrow.payments.find((item) => item.providerReference === providerReference)
    : contract.freelanceDetails.escrow.payments.find((item) => ['PENDING', 'PROCESSING'].includes(item.status));
  if (!payment) throw new ContractPaymentError('Payment attempt not found', 404);
  assertContractFundingPayment(payment, contract, contract.freelanceDetails.escrow);
  return { contract, payment };
};

export const verifyContractPayment = async ({ contractId, employerId, providerReference, transactionId, webhookClaim = null, expectedProvider }) => {
  const { contract, payment } = await findPaymentForVerification({ contractId, employerId, providerReference });
  if (expectedProvider && payment.provider !== expectedProvider) {
    throw new ContractPaymentError('Webhook provider does not match the stored payment provider', 409);
  }
  const resolvedContractId = contractId || contract.id;
  if (payment.status === 'SUCCESSFUL') {
    const suppliedTransactionId = String(transactionId ?? '');
    const transactionMatches = payment.provider === 'PAYSTACK'
      ? (!/^\d+$/.test(suppliedTransactionId) || payment.transactionId === suppliedTransactionId)
        && (!suppliedTransactionId || suppliedTransactionId === payment.providerReference || /^\d+$/.test(suppliedTransactionId))
      : payment.transactionId === suppliedTransactionId;
    if (!transactionMatches) {
      throw new ContractPaymentError(`${payment.provider} transaction does not match the reconciled payment`, 409);
    }
    return { payment: paymentResponse(payment), contract: await getContractForPayment(resolvedContractId, employerId) };
  }
  const providerPayment = payment.provider === 'PAYSTACK'
    ? await verifyPaystackTransaction(payment.providerReference)
    : await verifyFlutterwaveTransaction(transactionId);
  let verification;
  try {
    verification = validateProviderPayment(providerPayment, payment, transactionId);
  } catch (error) {
    if (!webhookClaim) {
      await transitionPaymentStatus(payment, 'PROCESSING', {
        ...(payment.metadata ?? {}),
        contractId: resolvedContractId,
        verificationFailure: error.message,
        providerTransactionId: String(providerPayment?.id ?? transactionId ?? ''),
      });
    }
    await createNotification({
      recipientUserId: employerId,
      type: 'ALERT',
      category: 'PAYMENT',
      eventKey: `contract:payment-verification-review:${payment.id}`,
      title: 'Contract payment could not be verified',
      message: 'The funding payment is still under verification. Please wait before starting another payment.',
      link: `/employer/contracts/${resolvedContractId}`,
    }).catch(() => undefined);
    throw error;
  }

  if (verification.status === 'FAILED') {
    const updatedPayment = await transitionPaymentStatus(payment, 'FAILED', {
      ...(payment.metadata ?? {}),
      contractId: resolvedContractId,
      providerStatus: String(providerPayment.status ?? ''),
      providerTransactionId: verification.transactionId,
    }, webhookClaim);
    if (updatedPayment.status === 'SUCCESSFUL') {
      if (updatedPayment.transactionId !== verification.transactionId) {
        throw new ContractPaymentError(`${payment.provider} transaction does not match the reconciled payment`, 409);
      }
      return { payment: paymentResponse(updatedPayment), contract: await getContractForPayment(resolvedContractId, employerId) };
    }
    await createNotification({
      recipientUserId: employerId,
      type: 'ALERT',
      category: 'PAYMENT',
      eventKey: `contract:payment-failed:${payment.id}`,
      title: 'Contract payment failed',
      message: `${payment.provider} confirmed that the funding payment failed. You can start a new payment attempt.`,
      link: `/employer/contracts/${resolvedContractId}`,
    }).catch(() => undefined);
    const error = new ContractPaymentError(`${payment.provider} payment verification failed`, 422);
    error.reconciliationComplete = true;
    throw error;
  }

  if (verification.status === 'PROCESSING') {
    const updatedPayment = await transitionPaymentStatus(payment, 'PROCESSING', {
      ...(payment.metadata ?? {}),
      contractId: resolvedContractId,
      providerStatus: String(providerPayment.status ?? ''),
      providerTransactionId: verification.transactionId,
    }, webhookClaim);
    if (updatedPayment.status === 'SUCCESSFUL' && updatedPayment.transactionId !== verification.transactionId) {
      throw new ContractPaymentError(`${payment.provider} transaction does not match the reconciled payment`, 409);
    }
    return {
      payment: paymentResponse(updatedPayment),
      pending: ['PENDING', 'PROCESSING'].includes(updatedPayment.status),
      failed: updatedPayment.status === 'FAILED',
      contract: await getContractForPayment(resolvedContractId, employerId),
    };
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${resolvedContractId}
      FOR UPDATE
    `;
    const lockedContract = await transaction.contract.findFirst({
      where: { id: resolvedContractId, employerId },
      select: {
        id: true,
        type: true,
        applicationId: true,
        status: true,
        employerId: true,
        freelanceDetails: { select: { currency: true } },
      },
    });
    if (!lockedContract) throw new ContractNotFoundError();
    if (lockedContract.type === 'FREELANCE_PROJECT' && !['PENDING', 'ACTIVE'].includes(lockedContract.status)) {
      throw new ContractPaymentError('Freelance project is no longer eligible for funding', 409);
    }
    if (lockedContract.type === 'CONTRACT_PROJECT' && lockedContract.status !== 'PENDING') {
      throw new ContractPaymentError('Contract Job is already finalized', 409);
    }

    await transaction.$queryRaw`
      SELECT "id"
      FROM "Escrow"
      WHERE "id" = ${payment.escrowId}
      FOR UPDATE
    `;
    await assertWebhookClaim(transaction, webhookClaim);
    const locked = await transaction.payment.findUnique({ where: { id: payment.id }, select: { ...paymentSelect, escrowId: true } });
    const escrow = await transaction.escrow.findUnique({
      where: { id: payment.escrowId },
      select: { id: true, status: true, currency: true, grossAmount: true, platformFeeAmount: true, seekerNetAmount: true },
    });
    if (!locked || !escrow) throw new ContractPaymentError('Payment escrow is unavailable', 422);
    assertContractFundingPayment(locked, lockedContract, escrow);
    if (locked.status === 'SUCCESSFUL') {
      if (locked.transactionId !== verification.transactionId || escrow.status !== 'FUNDED') {
        throw new ContractPaymentError('The reconciled payment and escrow state do not match', 409);
      }
      return { payment: paymentResponse(locked), contract: await getContractForPayment(resolvedContractId, employerId, transaction) };
    }
    if (escrow.status === 'FUNDED') throw new ContractPaymentError('The escrow is funded without a matching successful payment', 409);
    const projectAmount = new Prisma.Decimal(escrow.grossAmount);
    const platformFeeAmount = new Prisma.Decimal(escrow.platformFeeAmount);
    const isAdditiveFunding = isAdditiveFundingSnapshot({
      agreedAmount: escrow.grossAmount,
      seekerNetAmount: escrow.seekerNetAmount,
    });
    const expectedPaymentAmount = isAdditiveFunding ? projectAmount.plus(platformFeeAmount) : projectAmount;
    if (!['UNFUNDED', 'FUNDING'].includes(escrow.status) || !new Prisma.Decimal(locked.amount).eq(expectedPaymentAmount)) {
      throw new ContractPaymentError('The payment does not match the contract escrow', 422);
    }
    const updatedPayment = await transaction.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESSFUL', transactionId: verification.transactionId, verifiedAt: new Date(), metadata: { ...(locked.metadata ?? {}), providerStatus: providerPayment.status } },
      select: paymentSelect,
    });
    await transaction.escrow.update({
      where: { id: escrow.id },
      data: { status: 'FUNDED', fundedAmount: projectAmount, fundedAt: new Date() },
    });
    await transaction.financialLedgerEntry.createMany({
      data: [
        {
          entryType: 'EMPLOYER_PAYMENT',
          amount: locked.amount,
          currency: locked.currency,
          idempotencyKey: `escrow:${escrow.id}:employer-payment`,
          description: `Employer payment received for contract ${resolvedContractId}`,
          contractId: resolvedContractId,
          escrowId: escrow.id,
          paymentId: locked.id,
        },
        {
          entryType: 'ESCROW_FUNDED',
          amount: projectAmount,
          currency: locked.currency,
          idempotencyKey: `escrow:${escrow.id}:funded`,
          description: `Project amount held in escrow for contract ${resolvedContractId}`,
          contractId: resolvedContractId,
          escrowId: escrow.id,
          paymentId: locked.id,
        },
        {
          entryType: 'PLATFORM_FEE',
          amount: platformFeeAmount,
          currency: locked.currency,
          idempotencyKey: `escrow:${escrow.id}:platform-fee`,
          description: isAdditiveFunding
            ? `Platform funding charge added to the project amount for contract ${resolvedContractId}`
            : `Legacy platform fee deducted from the project amount for contract ${resolvedContractId}`,
          contractId: resolvedContractId,
          escrowId: escrow.id,
          paymentId: locked.id,
        },
      ],
      skipDuplicates: true,
    });
    const finalizedContract = lockedContract;
    if (finalizedContract?.type === 'CONTRACT_PROJECT') {
      if (finalizedContract.status !== 'PENDING') {
        throw new ContractPaymentError('Contract Job is already finalized');
      }
      await transaction.contract.update({ where: { id: resolvedContractId }, data: { status: 'ACTIVE' } });
      const accepted = await transaction.application.updateMany({
        where: { id: finalizedContract.applicationId, status: 'PAYMENT_PENDING' },
        data: { status: 'ACCEPTED' },
      });
      if (accepted.count !== 1) throw new ContractPaymentError('Contract Job application is not awaiting payment');
    } else if (finalizedContract?.type === 'FREELANCE_PROJECT') {
      if (!['PENDING', 'ACTIVE'].includes(finalizedContract.status)) {
        throw new ContractPaymentError('Freelance project is no longer eligible for funding');
      }
      if (finalizedContract.status === 'PENDING') {
        await transaction.contract.update({ where: { id: resolvedContractId }, data: { status: 'ACTIVE' } });
      }
      await transaction.freelanceContract.update({
        where: { contractId: resolvedContractId },
        data: { workStatus: 'IN_PROGRESS' },
      });
    }
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

const webhookEventWhere = (eventId, provider = 'FLUTTERWAVE') => ({
  provider_providerEventId: { provider, providerEventId: String(eventId) },
});

const webhookLeaseCutoff = (now) => new Date(now.getTime() - WEBHOOK_LEASE_MS);

const retryableWebhookError = (error) => (
  !error?.status
  || error.status >= 500
  || error.status === 408
  || error.status === 429
  || error.status === 404
);

const claimContractWebhookEvent = async (eventId, provider = 'FLUTTERWAVE', now = new Date()) => {
  const token = crypto.randomUUID();
  return prisma.$transaction(async (transaction) => {
    const where = webhookEventWhere(eventId, provider);
    const event = await transaction.providerWebhookEvent.findUnique({ where });
    if (!event || event.processedAt) return { state: 'processed' };
    if (!event.paymentReference || !event.transactionId) return { state: 'unrecoverable' };
    if (event.attempts >= MAX_WEBHOOK_ATTEMPTS) return { state: 'exhausted' };
    if (event.processingStartedAt && event.processingStartedAt > webhookLeaseCutoff(now)) return { state: 'busy' };
    const leaseExpired = event.processingStartedAt && event.processingStartedAt <= webhookLeaseCutoff(now);
    if (!leaseExpired && !event.processingStartedAt && !event.nextAttemptAt) return { state: 'rejected' };
    if (!leaseExpired && (!event.nextAttemptAt || event.nextAttemptAt > now)) return { state: 'not-due' };

    const claimed = await transaction.providerWebhookEvent.updateMany({
      where: {
        ...where,
        processedAt: null,
        attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
        OR: [
          { processingStartedAt: null, nextAttemptAt: { lte: now } },
          { processingStartedAt: { lt: webhookLeaseCutoff(now) } },
        ],
      },
      data: {
        attempts: { increment: 1 },
        processingStartedAt: now,
        claimToken: token,
        nextAttemptAt: null,
      },
    });
    if (claimed.count !== 1) return { state: 'busy' };
    const claimedEvent = await transaction.providerWebhookEvent.findUnique({ where });
    return { state: 'claimed', event: claimedEvent, token };
  });
};

const releaseContractWebhookClaim = async ({ eventId, provider = 'FLUTTERWAVE', token, attempts, error, now = new Date() }) => {
  const shouldRetry = retryableWebhookError(error) && attempts < MAX_WEBHOOK_ATTEMPTS;
  const retryDelay = WEBHOOK_RETRY_DELAYS_MS[Math.min(attempts - 1, WEBHOOK_RETRY_DELAYS_MS.length - 1)];
  await prisma.providerWebhookEvent.updateMany({
    where: { ...webhookEventWhere(eventId, provider), claimToken: token, processedAt: null },
    data: {
      processingStartedAt: null,
      claimToken: null,
      nextAttemptAt: shouldRetry ? new Date(now.getTime() + retryDelay) : null,
      lastError: error?.status ? `HTTP_${error.status}` : 'RECONCILIATION_ERROR',
    },
  });
  return shouldRetry;
};

const markContractWebhookProcessed = async ({ eventId, provider = 'FLUTTERWAVE', token }) => {
  const updated = await prisma.providerWebhookEvent.updateMany({
    where: { ...webhookEventWhere(eventId, provider), claimToken: token, processedAt: null },
    data: {
      processedAt: new Date(),
      processingStartedAt: null,
      claimToken: null,
      nextAttemptAt: null,
      lastError: null,
    },
  });
  if (updated.count !== 1) throw new ContractPaymentError('Webhook recovery claim expired; retry reconciliation', 503);
};

const processContractWebhookEvent = async (eventId, provider = 'FLUTTERWAVE', now = new Date()) => {
  const claim = await claimContractWebhookEvent(eventId, provider, now);
  if (claim.state === 'processed') return { duplicate: true };
  if (claim.state === 'busy') return { duplicate: true, processing: true };
  if (claim.state === 'not-due') throw new ContractPaymentError('Webhook reconciliation is scheduled for retry', 503);
  if (claim.state === 'exhausted' || claim.state === 'unrecoverable' || claim.state === 'rejected') {
    throw new ContractPaymentError('Webhook reconciliation requires manual review', 409);
  }

  try {
    const result = await verifyContractPayment({
      contractId: claim.event.contractId ?? undefined,
      providerReference: claim.event.paymentReference,
      transactionId: claim.event.transactionId,
      webhookClaim: { id: claim.event.id, token: claim.token },
      expectedProvider: provider,
    });
    if (result.pending) throw new ContractPaymentError(`${provider} payment reconciliation is still pending`, 503);
    await markContractWebhookProcessed({ eventId, provider, token: claim.token });
    return { duplicate: false, result };
  } catch (error) {
    if (error.reconciliationComplete) {
      await markContractWebhookProcessed({ eventId, provider, token: claim.token });
      throw error;
    }
    const retryScheduled = await releaseContractWebhookClaim({
      eventId,
      provider,
      token: claim.token,
      attempts: claim.event.attempts,
      error,
      now,
    });
    if (retryScheduled) {
      const retryError = new ContractPaymentError(`${provider} payment reconciliation is incomplete; retry scheduled`, 503);
      throw retryError;
    }
    throw error;
  }
};

export const handleFlutterwaveWebhook = async ({ payload }) => {
  const eventId = payload?.id ?? payload?.data?.id;
  const paymentReference = payload?.data?.tx_ref || payload?.data?.reference;
  const transactionId = payload?.data?.id ?? payload?.data?.transaction_id;
  const contractId = payload?.data?.meta?.contractId;
  if (!eventId || !paymentReference || !transactionId || !/^\d+$/.test(String(transactionId))) {
    throw new ContractPaymentError('Incomplete Flutterwave webhook payload', 400);
  }
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const eventWhere = webhookEventWhere(eventId);
  try {
    await prisma.providerWebhookEvent.create({
      data: {
        provider: 'FLUTTERWAVE',
        providerEventId: String(eventId),
        eventType: payload.event || null,
        payloadHash,
        contractId: contractId ? String(contractId) : null,
        paymentReference: String(paymentReference),
        transactionId: String(transactionId),
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existingEvent = await prisma.providerWebhookEvent.findUnique({ where: eventWhere });
    if (!existingEvent) throw error;
    if (existingEvent.payloadHash !== payloadHash) {
      throw new ContractPaymentError('Flutterwave reused a webhook event identifier with different content', 409);
    }
    if (existingEvent.processedAt) return { duplicate: true };
    if (existingEvent.paymentReference && existingEvent.paymentReference !== String(paymentReference)) {
      throw new ContractPaymentError('Flutterwave event payment reference does not match its stored event', 409);
    }
    if (existingEvent.transactionId && existingEvent.transactionId !== String(transactionId)) {
      throw new ContractPaymentError('Flutterwave event transaction ID does not match its stored event', 409);
    }
    if (existingEvent.contractId && contractId && existingEvent.contractId !== String(contractId)) {
      throw new ContractPaymentError('Flutterwave event contract does not match its stored event', 409);
    }
    if (!existingEvent.paymentReference || !existingEvent.transactionId || (!existingEvent.contractId && contractId)) {
      await prisma.providerWebhookEvent.update({
        where: eventWhere,
        data: {
          ...(contractId ? { contractId: String(contractId) } : {}),
          paymentReference: String(paymentReference),
          transactionId: String(transactionId),
          nextAttemptAt: new Date(),
        },
      });
    }
  }
  return processContractWebhookEvent(eventId, 'FLUTTERWAVE');
};

export const handlePaystackContractWebhook = async ({ payload }) => {
  if (payload?.event !== 'charge.success') return { ignored: true };
  const paymentReference = payload?.data?.reference;
  const transactionId = payload?.data?.id;
  if (!paymentReference || transactionId === undefined || !/^\d+$/.test(String(transactionId))) {
    throw new ContractPaymentError('Incomplete Paystack contract-funding webhook payload', 400);
  }
  const eventId = `charge.success:${String(transactionId)}`;
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const eventWhere = webhookEventWhere(eventId, 'PAYSTACK');
  try {
    await prisma.providerWebhookEvent.create({
      data: {
        provider: 'PAYSTACK',
        providerEventId: eventId,
        eventType: payload.event,
        payloadHash,
        paymentReference: String(paymentReference),
        transactionId: String(transactionId),
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existingEvent = await prisma.providerWebhookEvent.findUnique({ where: eventWhere });
    if (!existingEvent) throw error;
    if (existingEvent.payloadHash !== payloadHash) {
      throw new ContractPaymentError('Paystack reused a webhook event identifier with different content', 409);
    }
    if (existingEvent.processedAt) return { duplicate: true };
    if (existingEvent.paymentReference && existingEvent.paymentReference !== String(paymentReference)) {
      throw new ContractPaymentError('Paystack event payment reference does not match its stored event', 409);
    }
    if (existingEvent.transactionId && existingEvent.transactionId !== String(transactionId)) {
      throw new ContractPaymentError('Paystack event transaction ID does not match its stored event', 409);
    }
  }
  return processContractWebhookEvent(eventId, 'PAYSTACK');
};

export const getPaystackContractReturnUrl = async (reference) => {
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new ContractPaymentError('Paystack payment reference is required', 400);
  }
  const payment = await prisma.payment.findUnique({
    where: { providerReference: reference },
    select: {
      provider: true,
      paymentType: true,
      metadata: true,
      escrow: {
        select: {
          freelanceContract: { select: { contract: { select: { id: true } } } },
        },
      },
    },
  });
  const contract = payment?.escrow?.freelanceContract?.contract;
  if (!payment || payment.provider !== 'PAYSTACK' || payment.paymentType !== 'CONTRACT_FUNDING' || !contract) {
    throw new ContractNotFoundError();
  }
  const contractId = contract.id;
  const configuredPath = payment.metadata?.returnPath;
  const employerPath = `/employer/contracts/${encodeURIComponent(contractId)}`;
  const adminPath = `/admin/contracts/${encodeURIComponent(contractId)}`;
  const returnPath = typeof configuredPath === 'string' && [employerPath, adminPath].includes(configuredPath)
    ? configuredPath
    : employerPath;
  const frontendBaseUrl = env.FRONTEND_URL || env.FRONTEND_URL_PROD;
  if (!frontendBaseUrl) throw new ContractPaymentError('Frontend return URL is not configured', 503);
  const frontendUrl = frontendBaseUrl.replace(/\/$/, '');
  const query = new URLSearchParams({ transaction_id: reference, tx_ref: reference });
  return `${frontendUrl}${returnPath}?${query.toString()}`;
};

export const processPendingContractWebhookEvents = async ({ batchSize = 25, now = new Date() } = {}) => {
  const leaseCutoff = webhookLeaseCutoff(now);
  const events = await prisma.providerWebhookEvent.findMany({
    where: {
      provider: { in: ['FLUTTERWAVE', 'PAYSTACK'] },
      processedAt: null,
      paymentReference: { not: null },
      transactionId: { not: null },
      attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
      OR: [
        { nextAttemptAt: { lte: now }, processingStartedAt: null },
        { processingStartedAt: { lt: leaseCutoff } },
      ],
    },
    select: { provider: true, providerEventId: true },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
  });
  let processed = 0;
  let deferred = 0;
  for (const event of events) {
    try {
      const result = await processContractWebhookEvent(event.providerEventId, event.provider, now);
      if (!result.processing) processed += 1;
      else deferred += 1;
    } catch {
      deferred += 1;
    }
  }
  return { examined: events.length, processed, deferred };
};