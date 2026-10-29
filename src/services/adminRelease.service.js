import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { createNotification } from './notification.service.js';
import { assertFreelancePaymentFeatureEnabled } from '../config/freelancePaymentFeatures.js';

export class AdminReleaseNotFoundError extends Error {
  constructor() {
    super('Release-eligible contract not found');
    this.name = 'AdminReleaseNotFoundError';
    this.status = 404;
  }
}

export class AdminReleaseConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminReleaseConflictError';
    this.status = 409;
  }
}

const releaseSelect = {
  id: true,
  freelanceContractId: true,
  grossAmount: true,
  platformFeeAmount: true,
  seekerNetAmount: true,
  currency: true,
  status: true,
  fundedAmount: true,
  fundedAt: true,
  refundedAmount: true,
  releasedAmount: true,
  releasedAt: true,
};

const decimalToString = (value) => value.toFixed(2);

const matchedVerifiedFundingPayment = (escrow) => {
  const grossAmount = new Prisma.Decimal(escrow.grossAmount);
  const platformFeeAmount = new Prisma.Decimal(escrow.platformFeeAmount);
  const expectedPaymentAmount = new Prisma.Decimal(escrow.seekerNetAmount).eq(grossAmount)
    ? grossAmount.plus(platformFeeAmount)
    : grossAmount;
  return escrow.payments?.find((payment) => (
    payment.paymentType === 'CONTRACT_FUNDING'
    && payment.status === 'SUCCESSFUL'
    && Boolean(payment.verifiedAt)
    && typeof payment.transactionId === 'string'
    && payment.transactionId.trim() !== ''
    && payment.currency === escrow.currency
    && new Prisma.Decimal(payment.amount).eq(expectedPaymentAmount)
  )) ?? null;
};

const hasVerifiedFundingPayment = (escrow) => Boolean(matchedVerifiedFundingPayment(escrow));
const requiresRefundReview = (refund) => !['FAILED', 'CANCELLED'].includes(refund.status);
const hasRefundExposure = (escrow) => (
  new Prisma.Decimal(escrow.refundedAmount ?? 0).gt(0)
  || escrow.refunds?.some(requiresRefundReview) === true
);

const releaseCandidateSelect = {
  id: true,
  job: { select: { id: true, title: true } },
  employer: { select: { id: true, firstName: true, lastName: true, email: true } },
  seeker: { select: { id: true, firstName: true, lastName: true, email: true } },
  freelanceDetails: {
    select: {
      agreedAmount: true,
      currency: true,
      platformFeePercentage: true,
      platformFeeAmount: true,
      seekerNetAmount: true,
      completionSubmittedAt: true,
      employerCompletionConfirmedAt: true,
      workStatus: true,
      escrow: {
        select: {
          id: true,
          grossAmount: true,
          platformFeeAmount: true,
          seekerNetAmount: true,
          currency: true,
          status: true,
          fundedAmount: true,
          fundedAt: true,
          refundedAmount: true,
          releaseEligibleAt: true,
          releasedAmount: true,
          releasedAt: true,
          payments: {
            where: { paymentType: 'CONTRACT_FUNDING' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, amount: true, currency: true, paymentType: true, provider: true, providerReference: true, status: true, transactionId: true, verifiedAt: true },
          },
          disputes: { select: { id: true, status: true, openedAt: true } },
          refunds: { orderBy: { requestedAt: 'desc' }, select: { id: true, amount: true, currency: true, provider: true, providerReference: true, status: true, requestedAt: true } },
        },
      },
    },
  },
};

const mapReleaseCandidate = (contract) => ({
  contractId: contract.id,
  job: contract.job,
  employer: contract.employer,
  seeker: contract.seeker,
  freelance: {
    agreedAmount: decimalToString(contract.freelanceDetails.agreedAmount),
    currency: contract.freelanceDetails.currency,
    platformFeePercentage: decimalToString(contract.freelanceDetails.platformFeePercentage),
    platformFeeAmount: decimalToString(contract.freelanceDetails.platformFeeAmount),
    seekerNetAmount: decimalToString(contract.freelanceDetails.seekerNetAmount),
    completionSubmittedAt: contract.freelanceDetails.completionSubmittedAt,
    employerCompletionConfirmedAt: contract.freelanceDetails.employerCompletionConfirmedAt,
    workStatus: contract.freelanceDetails.workStatus,
    escrow: (() => {
      const escrow = contract.freelanceDetails.escrow;
      const matchedPayment = matchedVerifiedFundingPayment(escrow);
      const fundingVerified = Boolean(matchedPayment)
        && Boolean(escrow.fundedAt)
        && new Prisma.Decimal(escrow.fundedAmount).eq(escrow.grossAmount);
      const disputes = escrow.disputes ?? [];
      const refunds = escrow.refunds ?? [];
      const refundExposure = hasRefundExposure(escrow);
      const manualReviewIndicators = [];
      if (!fundingVerified) manualReviewIndicators.push('NO_MATCHING_VERIFIED_FUNDING');
      if (disputes.length) manualReviewIndicators.push('DISPUTE_PRESENT');
      if (refundExposure) manualReviewIndicators.push('REFUND_REQUIRES_REVIEW');
      if ((escrow.payments ?? []).length > 1) manualReviewIndicators.push('MULTIPLE_FUNDING_ATTEMPTS');
      const fundingState = refundExposure
        ? 'REFUND_REVIEW'
        : disputes.length
          ? 'DISPUTE_REVIEW'
          : fundingVerified
            ? 'VERIFIED_FUNDED'
            : new Prisma.Decimal(escrow.fundedAmount ?? 0).isZero() && !(escrow.payments ?? []).length
              ? 'UNFUNDED'
              : (escrow.payments ?? []).some((payment) => ['PENDING', 'PROCESSING'].includes(payment.status))
                ? 'PENDING_OR_UNVERIFIED'
                : 'MANUAL_REVIEW';
      return {
      id: contract.freelanceDetails.escrow.id,
      currency: contract.freelanceDetails.escrow.currency,
      status: contract.freelanceDetails.escrow.status,
      fundingVerified,
      fundingState,
      matchedFundingPayment: matchedPayment ? {
        id: matchedPayment.id,
        provider: matchedPayment.provider,
        providerReference: matchedPayment.providerReference,
        transactionId: matchedPayment.transactionId,
        amount: decimalToString(matchedPayment.amount),
        currency: matchedPayment.currency,
        status: matchedPayment.status,
        verifiedAt: matchedPayment.verifiedAt,
      } : null,
      fundingPayments: (escrow.payments ?? []).map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        providerReference: payment.providerReference,
        transactionId: payment.transactionId,
        amount: decimalToString(payment.amount),
        currency: payment.currency,
        status: payment.status,
        verifiedAt: payment.verifiedAt,
      })),
      disputes: disputes.map(({ id, status, openedAt }) => ({ id, status, openedAt })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amount: decimalToString(refund.amount),
        currency: refund.currency,
        provider: refund.provider,
        providerReference: refund.providerReference,
        status: refund.status,
        requestedAt: refund.requestedAt,
      })),
      refundedAmount: decimalToString(new Prisma.Decimal(escrow.refundedAmount ?? 0)),
      manualReviewIndicators,
      grossAmount: decimalToString(contract.freelanceDetails.escrow.grossAmount),
      platformFeeAmount: decimalToString(contract.freelanceDetails.escrow.platformFeeAmount),
      seekerNetAmount: decimalToString(contract.freelanceDetails.escrow.seekerNetAmount),
      releaseEligibleAt: contract.freelanceDetails.escrow.releaseEligibleAt,
      releasedAmount: decimalToString(contract.freelanceDetails.escrow.releasedAmount),
      releasedAt: contract.freelanceDetails.escrow.releasedAt,
      };
    })(),
  },
});

export const listReleaseEligibleContracts = async ({ page = 1, limit = 50 } = {}) => {
  const where = {
      type: { in: ['FREELANCE_PROJECT', 'CONTRACT_PROJECT'] },
      freelanceDetails: { escrow: { status: 'RELEASE_ELIGIBLE' } },
  };
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit, select: releaseCandidateSelect }),
    prisma.contract.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { contracts: contracts.map(mapReleaseCandidate), pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 } };
};

const lockEscrow = async (transaction, contractId) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Escrow"
    WHERE "freelanceContractId" = ${contractId}
    FOR UPDATE
  `;

  return transaction.escrow.findUnique({
    where: { freelanceContractId: contractId },
    select: {
      ...releaseSelect,
      payments: {
        where: { paymentType: 'CONTRACT_FUNDING' },
        select: { id: true, amount: true, currency: true, paymentType: true, provider: true, providerReference: true, status: true, transactionId: true, verifiedAt: true },
      },
      payments: {
        where: { paymentType: 'CONTRACT_FUNDING' },
        select: { id: true, amount: true, currency: true, paymentType: true, provider: true, providerReference: true, status: true, transactionId: true, verifiedAt: true },
      },
      refunds: { select: { id: true, amount: true, currency: true, status: true } },
      freelanceContract: {
        select: {
          agreedAmount: true,
          currency: true,
          completionSubmittedAt: true,
          employerCompletionConfirmedAt: true,
          workStatus: true,
          contract: {
            select: {
              id: true,
              type: true,
              status: true,
              seekerId: true,
            },
          },
        },
      },
    },
  });
};

export const releaseContractFunds = async (contractId, actorUserId) => {
  if (typeof actorUserId !== 'string' || !actorUserId.trim()) {
    throw new AdminReleaseConflictError('An authenticated admin is required to authorize escrow release');
  }
  return prisma.$transaction(async (transaction) => {
    const escrow = await lockEscrow(transaction, contractId);
    if (!escrow) throw new AdminReleaseNotFoundError();

    const contract = escrow.freelanceContract.contract;
    const dispute = await transaction.dispute.findFirst({
      where: { OR: [{ contractId: contract.id }, { escrowId: escrow.id }] },
      select: { id: true, status: true },
    });
    if (dispute) {
      throw new AdminReleaseConflictError('This escrow has a dispute record and cannot be released until a separate refund or release decision is authorized.');
    }
    if (escrow.status === 'RELEASED') {
      return { alreadyReleased: true, escrow: releaseResult(escrow) };
    }
    assertFreelancePaymentFeatureEnabled('escrowReleaseEnabled');

    if (!['FREELANCE_PROJECT', 'CONTRACT_PROJECT'].includes(contract.type)) {
      throw new AdminReleaseConflictError('Only protected paid-work contracts can be released');
    }
    if (!['ACTIVE', 'IN_PROGRESS'].includes(contract.status)) {
      throw new AdminReleaseConflictError('The contract is not in a releasable state');
    }
    if (!escrow.freelanceContract.completionSubmittedAt || !escrow.freelanceContract.employerCompletionConfirmedAt) {
      throw new AdminReleaseConflictError('Completion must be submitted and confirmed before release');
    }
    if (escrow.status !== 'RELEASE_ELIGIBLE') {
      throw new AdminReleaseConflictError('The escrow is not release eligible');
    }
    if (!escrow.fundedAt
      || !new Prisma.Decimal(escrow.fundedAmount).eq(escrow.grossAmount)
      || !hasVerifiedFundingPayment(escrow)) {
      throw new AdminReleaseConflictError('A verified provider funding payment is required before escrow release');
    }
    if (new Prisma.Decimal(escrow.refundedAmount ?? 0).gt(0) || escrow.refunds?.some(requiresRefundReview)) {
      throw new AdminReleaseConflictError('This escrow has a refund amount or refund operation that requires review before release');
    }

    const seekerNetAmount = new Prisma.Decimal(escrow.seekerNetAmount);
    const grossAmount = new Prisma.Decimal(escrow.grossAmount);
    if (seekerNetAmount.lte(0) || seekerNetAmount.gt(grossAmount)) {
      throw new AdminReleaseConflictError('The escrow release amount is invalid');
    }
    if (!/^[A-Z]{3}$/.test(escrow.currency) || escrow.currency !== escrow.freelanceContract.currency) {
      throw new AdminReleaseConflictError('The escrow currency is invalid');
    }

    const lockedWallets = await transaction.$queryRaw`
      SELECT "id", "currency", "availableBalance", "pendingWithdrawalBalance"
      FROM "Wallet"
      WHERE "userId" = ${contract.seekerId}
      FOR UPDATE
    `;
    if (lockedWallets.length === 0) throw new AdminReleaseConflictError('The seeker wallet does not exist');
    const wallet = lockedWallets.find((candidate) => candidate.currency === escrow.currency);
    if (!wallet) {
      const destinationWallet = lockedWallets.find((candidate) => (
        candidate.currency !== escrow.currency && ['NGN', 'USD'].includes(candidate.currency)
      ));
      if (!destinationWallet || !['NGN', 'USD'].includes(escrow.currency)) {
        throw new AdminReleaseConflictError('The escrow currency does not match an available seeker wallet');
      }
      const statusReason = 'Cross-currency settlement is disabled pending provider and account approval.';
      const operation = await transaction.conversionOperation.upsert({
        where: { escrowId: escrow.id },
        update: {},
        create: {
          seekerId: contract.seekerId,
          escrowId: escrow.id,
          destinationWalletId: destinationWallet.id,
          idempotencyKey: `escrow:${escrow.id}:currency-conversion`,
          sourceCurrency: escrow.currency,
          destinationCurrency: destinationWallet.currency,
          sourceAmount: seekerNetAmount,
          status: 'BLOCKED',
          statusReason,
          events: {
            create: {
              fromStatus: null,
              toStatus: 'BLOCKED',
              eventType: 'CONVERSION_DISABLED',
              reason: statusReason,
            },
          },
        },
        select: { id: true, status: true, statusReason: true },
      });
      return { conversionBlocked: true, conversionOperation: operation };
    }

    const resultingBalance = new Prisma.Decimal(wallet.availableBalance).plus(seekerNetAmount);
    const releasedAt = new Date();
    const updatedWallet = await transaction.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: resultingBalance,
        version: { increment: 1 },
      },
      select: { availableBalance: true },
    });

    await transaction.financialLedgerEntry.create({
      data: {
        entryType: 'WALLET_CREDIT',
        amount: seekerNetAmount,
        currency: escrow.currency,
        balanceAfter: updatedWallet.availableBalance,
        idempotencyKey: `escrow:${escrow.id}:release`,
        description: 'Freelance contract funds released to seeker wallet',
        walletId: wallet.id,
        contractId: contract.id,
        escrowId: escrow.id,
      },
    });

    const releasedEscrow = await transaction.escrow.update({
      where: { id: escrow.id },
      data: {
        status: 'RELEASED',
        releasedAmount: seekerNetAmount,
        releasedAt,
      },
      select: releaseSelect,
    });

    await transaction.freelanceContract.update({
      where: { contractId: contract.id },
      data: { workStatus: 'RELEASED' },
    });

    const fundingPayment = matchedVerifiedFundingPayment(escrow);
    await transaction.financialAuditLog.create({
      data: {
        actorUserId,
        entityType: 'ESCROW',
        entityId: escrow.id,
        action: 'RELEASED',
        fromStatus: escrow.status,
        toStatus: 'RELEASED',
        amount: seekerNetAmount,
        currency: escrow.currency,
        reason: 'Authorized admin escrow release',
        metadata: {
          contractId: contract.id,
          paymentId: fundingPayment.id,
          provider: fundingPayment.provider,
          providerReference: fundingPayment.providerReference,
          transactionId: fundingPayment.transactionId,
        },
      },
    });

    await createNotification({
      recipientUserId: contract.seekerId,
      type: 'SUCCESS',
      category: 'PAYMENT',
      eventKey: `escrow:released:${escrow.id}`,
      title: 'Contract payment released',
      message: 'Your contract payment has been released to your wallet.',
      link: '/seeker/payments',
    }, transaction).catch(() => undefined);

    return { alreadyReleased: false, escrow: releaseResult(releasedEscrow) };
  });
};

const releaseResult = (escrow) => ({
  escrowId: escrow.id,
  contractId: escrow.freelanceContractId,
  status: escrow.status,
  releasedAmount: decimalToString(escrow.releasedAmount),
  currency: escrow.currency,
  releasedAt: escrow.releasedAt,
});