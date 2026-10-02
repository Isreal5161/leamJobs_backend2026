import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { initializeFlutterwavePayment, verifyFlutterwaveTransaction } from './flutterwave.service.js';
import { contractSelect, ContractNotFoundError, mapContract } from './contract.service.js';
import { createNotification } from './notification.service.js';

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

const MAX_PAYMENT_AMOUNT = new Prisma.Decimal('9999999999.99');
const INITIALIZATION_CLAIM_KEY = 'checkoutInitialization';

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
  } else if (contract.status !== 'ACTIVE') {
    throw new ContractPaymentError('Only active contracts can be funded');
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

export const initializeContractPayment = async ({ contractId, employerId, idempotencyKey, redirectPath }) => {
  const requestedKey = idempotencyKey?.trim();
  if (requestedKey && requestedKey.length > 100) throw new ContractPaymentError('Idempotency key is too long', 400);
  const initializationToken = crypto.randomUUID();

  const attempt = await prisma.$transaction(async (transaction) => {
    const contract = await lockPaymentContract(transaction, contractId);
    assertPaymentContract(contract, employerId);
    const existing = findExistingAttempt(contract.freelanceDetails.escrow.payments, requestedKey);
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
        payment,
        initializationToken,
        email: contract.employer.email,
        amount: payment.amount,
        currency: payment.currency,
        fundingBreakdown: fundingBreakdown(contract.freelanceDetails, payment.amount),
      };
    }

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
        provider: 'FLUTTERWAVE',
        metadata: {
          contractId,
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
    const checkout = await initializeFlutterwavePayment({
      amount: new Prisma.Decimal(attempt.amount).toFixed(2),
      currency: attempt.currency,
      email: attempt.email,
      txRef: attempt.payment.providerReference,
      meta: {
        contractId,
        projectAmount: attempt.payment.metadata?.projectAmount ?? new Prisma.Decimal(attempt.amount).toFixed(2),
        platformFeeAmount: attempt.payment.metadata?.platformFeeAmount ?? '0.00',
      },
      redirectUrl: `${env.FRONTEND_URL}${redirectPath || `/employer/contracts/${encodeURIComponent(contractId)}`}`,
    });
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
  const providerReference = providerPayment.tx_ref || providerPayment.reference;
  const referenceMatches = providerReference === payment.providerReference;
  const transactionMatches = String(providerPayment.id ?? '') === String(transactionId);
  const status = String(providerPayment.status ?? '').toLowerCase();
  if (!referenceMatches || !transactionMatches) {
    throw new ContractPaymentError('Flutterwave payment verification failed', 422);
  }
  if (status === 'successful') {
    const amountMatches = new Prisma.Decimal(providerPayment.amount ?? 0).eq(payment.amount);
    const currencyMatches = String(providerPayment.currency || '').toUpperCase() === payment.currency;
    if (!amountMatches || !currencyMatches) throw new ContractPaymentError('Flutterwave payment verification failed', 422);
    return 'SUCCESSFUL';
  }
  if (['failed', 'cancelled', 'canceled'].includes(status)) return 'FAILED';
  return 'PROCESSING';
};

const transitionPaymentStatus = async (payment, status, metadata) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Escrow"
    WHERE "id" = ${payment.escrowId}
    FOR UPDATE
  `;
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
  let providerStatus;
  try {
    providerStatus = validateProviderPayment(providerPayment, payment, transactionId);
  } catch (error) {
    await transitionPaymentStatus(payment, 'PROCESSING', {
      ...(payment.metadata ?? {}),
      contractId: resolvedContractId,
      verificationFailure: error.message,
      providerTransactionId: String(transactionId),
    });
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

  if (providerStatus === 'FAILED') {
    const updatedPayment = await transitionPaymentStatus(payment, providerStatus, {
      ...(payment.metadata ?? {}),
      contractId: resolvedContractId,
      providerStatus: String(providerPayment.status ?? ''),
      providerTransactionId: String(providerPayment.id),
    });
    if (updatedPayment.status === 'SUCCESSFUL') {
      return { payment: paymentResponse(updatedPayment), contract: await getContractForPayment(resolvedContractId, employerId) };
    }
    await createNotification({
      recipientUserId: employerId,
      type: 'ALERT',
      category: 'PAYMENT',
      eventKey: `contract:payment-failed:${payment.id}`,
      title: 'Contract payment failed',
      message: 'Flutterwave confirmed that the funding payment failed. You can start a new payment attempt.',
      link: `/employer/contracts/${resolvedContractId}`,
    }).catch(() => undefined);
    throw new ContractPaymentError('Flutterwave payment verification failed', 422);
  }

  if (providerStatus === 'PROCESSING') {
    const updatedPayment = await transitionPaymentStatus(payment, providerStatus, {
      ...(payment.metadata ?? {}),
      contractId: resolvedContractId,
      providerStatus: String(providerPayment.status ?? ''),
      providerTransactionId: String(providerPayment.id),
    });
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
      FROM "Escrow"
      WHERE "id" = ${payment.escrowId}
      FOR UPDATE
    `;
    const locked = await transaction.payment.findUnique({ where: { id: payment.id }, select: { ...paymentSelect, escrowId: true } });
    const escrow = await transaction.escrow.findUnique({
      where: { id: payment.escrowId },
      select: { id: true, status: true, grossAmount: true, platformFeeAmount: true, seekerNetAmount: true },
    });
    if (!locked || !escrow) throw new ContractPaymentError('Payment escrow is unavailable', 422);
    if (locked.status === 'SUCCESSFUL' || escrow.status === 'FUNDED') {
      return { payment: paymentResponse(locked), contract: await getContractForPayment(resolvedContractId, employerId, transaction) };
    }
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
      data: { status: 'SUCCESSFUL', transactionId: String(providerPayment.id), verifiedAt: new Date(), metadata: { ...(locked.metadata ?? {}), providerStatus: providerPayment.status } },
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
    const finalizedContract = await transaction.contract.findUnique({
      where: { id: resolvedContractId },
      select: { type: true, applicationId: true, status: true },
    });
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
    if (result.pending) {
      await prisma.providerWebhookEvent.delete({
        where: { provider_providerEventId: { provider: 'FLUTTERWAVE', providerEventId: String(eventId) } },
      });
      return { duplicate: false, result };
    }
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