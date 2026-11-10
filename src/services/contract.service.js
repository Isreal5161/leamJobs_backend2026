import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { createNotification } from './notification.service.js';

export const contractSelect = {
  id: true,
  applicationId: true,
  jobId: true,
  employerId: true,
  seekerId: true,
  type: true,
  status: true,
  startDate: true,
  expectedEndDate: true,
  completedAt: true,
  endedAt: true,
  cancelledAt: true,
  employerArchivedAt: true,
  disputes: { select: { id: true, status: true } },
  ledgerEntries: { select: { id: true } },
  job: { select: { id: true, employerId: true, title: true, description: true, jobType: true, engagementType: true } },
  application: { select: { id: true, jobId: true, seekerId: true, status: true, createdAt: true } },
  employer: { select: { id: true, firstName: true, lastName: true } },
  seeker: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      seekerProfile: { select: { professionalTitle: true, profilePictureUrl: true } },
    },
  },
  createdAt: true,
  updatedAt: true,
  freelanceDetails: {
    select: {
      id: true,
      contractId: true,
      agreedAmount: true,
      currency: true,
      duration: true,
      startMode: true,
      platformFeePercentage: true,
      platformFeeAmount: true,
      seekerNetAmount: true,
      employerConfirmedAt: true,
      seekerConfirmedAt: true,
      employerCompletionConfirmedAt: true,
      completionSubmittedAt: true,
      completionNote: true,
      workStatus: true,
      expectedCompletionDate: true,
      escrow: {
        select: {
          id: true,
          freelanceContractId: true,
          grossAmount: true,
          platformFeeAmount: true,
          seekerNetAmount: true,
          currency: true,
          fundedAmount: true,
          releasedAmount: true,
          refundedAmount: true,
          status: true,
          fundedAt: true,
          releasedAt: true,
          cancelledAt: true,
          releaseEligibleAt: true,
          payments: {
            where: { paymentType: 'CONTRACT_FUNDING' },
            select: {
              id: true,
              amount: true,
              currency: true,
              transactionId: true,
              status: true,
              paymentType: true,
              provider: true,
              providerReference: true,
              verifiedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          refunds: { select: { id: true, status: true } },
          disputes: { select: { id: true, status: true } },
          ledgerEntries: { select: { id: true } },
          conversionOperation: { select: { id: true, status: true } },
        },
      },
    },
  },
};

export const cancelledContractAuditSelect = {
  id: true,
  applicationId: true,
  jobId: true,
  employerId: true,
  seekerId: true,
  type: true,
  status: true,
  cancelledAt: true,
  completedAt: true,
  endedAt: true,
  job: { select: { id: true, employerId: true, jobType: true, engagementType: true } },
  application: { select: { id: true, jobId: true, seekerId: true, status: true } },
  freelanceDetails: {
    select: {
      contractId: true,
      workStatus: true,
      completionSubmittedAt: true,
      employerConfirmedAt: true,
      seekerConfirmedAt: true,
      employerCompletionConfirmedAt: true,
      escrow: {
        select: {
          id: true,
          freelanceContractId: true,
          status: true,
          cancelledAt: true,
          fundedAmount: true,
          releasedAmount: true,
          refundedAmount: true,
          fundedAt: true,
          releasedAt: true,
          releaseEligibleAt: true,
          refunds: { select: { id: true } },
          disputes: { select: { id: true } },
          ledgerEntries: { select: { id: true } },
        },
      },
    },
  },
};

export class ContractNotFoundError extends Error {
  constructor() {
    super('Contract not found');
    this.name = 'ContractNotFoundError';
    this.status = 404;
  }
}

export class ContractConfirmationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractConfirmationError';
    this.status = 409;
  }
}

export class ContractProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractProgressError';
    this.status = 409;
  }
}

export class FreelanceContractCancellationError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'FreelanceContractCancellationError';
    this.status = status;
    this.publicCode = 'CONTRACT_CANCELLATION_BLOCKED';
    this.publicMessage = message;
  }
}

const decimalToString = (value) => value === null || value === undefined ? null : value.toFixed(2);

const fundingPaymentAmount = (details) => {
  if (!details?.agreedAmount || details.platformFeeAmount === null || details.platformFeeAmount === undefined
    || details.seekerNetAmount === null || details.seekerNetAmount === undefined) return null;
  const amount = new Prisma.Decimal(details.agreedAmount);
  const additive = new Prisma.Decimal(details.seekerNetAmount).eq(amount);
  return decimalToString(additive ? amount.plus(details.platformFeeAmount) : amount);
};

const contractPaymentHistoryWhere = (contractId) => ({
  OR: [
    { metadata: { path: ['contractId'], equals: contractId } },
    { providerReference: { startsWith: `leamjobs_${contractId}_` } },
  ],
});

export const findContractFundingPayments = async (client, contractId, { lock = false } = {}) => {
  if (lock) {
    const providerReferencePrefix = `leamjobs_${contractId}_`;
    await client.$queryRaw`
      SELECT "id"
      FROM "Payment"
      WHERE "metadata" ->> 'contractId' = ${contractId}
        OR LEFT("providerReference", ${providerReferencePrefix.length}::int4) = ${providerReferencePrefix}
      FOR UPDATE
    `;
  }

  return client.payment.findMany({
    where: contractPaymentHistoryWhere(contractId),
    select: { id: true, status: true, escrowId: true, providerReference: true },
    orderBy: { createdAt: 'desc' },
  });
};

const escrowHasFinancialActivity = (escrow) => Boolean(escrow && (
  new Prisma.Decimal(escrow.fundedAmount ?? 0).gt(0)
  || new Prisma.Decimal(escrow.releasedAmount ?? 0).gt(0)
  || new Prisma.Decimal(escrow.refundedAmount ?? 0).gt(0)
  || Boolean(escrow.fundedAt || escrow.releasedAt || escrow.releaseEligibleAt)
  || (escrow.refunds ?? []).length > 0
  || (escrow.disputes ?? []).length > 0
  || (escrow.ledgerEntries ?? []).length > 0
));

const contractAssociationsMatch = (contract) => Boolean(
  contract.job?.id === contract.jobId
  && contract.job.employerId === contract.employerId
  && contract.application?.id === contract.applicationId
  && contract.application.jobId === contract.jobId
  && contract.application.seekerId === contract.seekerId
  && contract.freelanceDetails?.contractId === contract.id
  && (!contract.freelanceDetails.escrow
    || contract.freelanceDetails.escrow.freelanceContractId === contract.id),
);

const hasConsistentUnfundedEscrow = (escrow) => !escrow || (
  escrow.status === 'UNFUNDED'
  && !escrow.cancelledAt
  && !escrowHasFinancialActivity(escrow)
);

const contractTypeMatchesJob = (contract) => (
  (contract.type === 'FREELANCE_PROJECT'
    && contract.job?.jobType === 'FREELANCE_PROJECT'
    && contract.job?.engagementType === 'FREELANCE')
  || (contract.type === 'CONTRACT_PROJECT'
    && contract.job?.jobType === 'NORMAL_EMPLOYMENT'
    && contract.job?.engagementType === 'CONTRACT')
);

const hasPendingContractWebhook = (client, contractId) => client.providerWebhookEvent.findFirst({
  where: {
    processedAt: null,
    OR: [
      { contractId },
      { paymentReference: { startsWith: `leamjobs_${contractId}_` } },
    ],
  },
  select: { id: true },
});

export const hasNoContractFinancialHistory = async (client, contractId, escrowId = null, employerId = null) => {
  const providerReferencePrefix = `leamjobs_${contractId}_`;
  const [payments, ledgerEntry, dispute, financialAuditLog] = await Promise.all([
    client.payment.findFirst({
      where: {
        OR: [
          { metadata: { path: ['contractId'], equals: contractId } },
          { providerReference: { startsWith: providerReferencePrefix } },
          ...(escrowId ? [{ escrowId }] : []),
          ...(employerId ? [{ userId: employerId, paymentType: 'CONTRACT_FUNDING', escrowId: null }] : []),
        ],
      },
      select: { id: true },
    }),
    client.financialLedgerEntry.findFirst({
      where: { OR: [{ contractId }, ...(escrowId ? [{ escrowId }] : [])] },
      select: { id: true },
    }),
    client.dispute.findFirst({
      where: { OR: [{ contractId }, ...(escrowId ? [{ escrowId }] : [])] },
      select: { id: true },
    }),
    client.financialAuditLog.findFirst({
      where: {
        entityType: { in: ['CONTRACT', ...(escrowId ? ['ESCROW'] : [])] },
        entityId: { in: [contractId, ...(escrowId ? [escrowId] : [])] },
        action: { notIn: ['CREATED', 'CANCELLED'] },
      },
      select: { id: true },
    }),
  ]);
  return !payments && !ledgerEntry && !dispute && !financialAuditLog;
};

export const canPossiblyCancelContract = (contract) => {
  const commonLifecycle = contract.freelanceDetails?.workStatus === 'PENDING'
    && !contract.freelanceDetails?.completionSubmittedAt
    && !contract.freelanceDetails?.employerConfirmedAt
    && !contract.freelanceDetails?.seekerConfirmedAt
    && !contract.freelanceDetails?.employerCompletionConfirmedAt
    && !contract.completedAt
    && !contract.endedAt
    && !contract.cancelledAt
    && contractAssociationsMatch(contract)
    && contractTypeMatchesJob(contract)
    && hasConsistentUnfundedEscrow(contract.freelanceDetails?.escrow);
  if (!commonLifecycle) return false;

  if (contract.type === 'FREELANCE_PROJECT') {
    return ['PENDING', 'ACTIVE'].includes(contract.status)
      && contract.application?.status === 'ACCEPTED';
  }

  return contract.type === 'CONTRACT_PROJECT'
    && contract.status === 'PENDING'
    && contract.application?.status === 'PAYMENT_PENDING';
};

export const isSafelyCancelledContract = async (client, contract) => {
  const escrow = contract.freelanceDetails?.escrow;
  const validLifecycle = contract.status === 'CANCELLED'
    && Boolean(contract.cancelledAt)
    && !contract.completedAt
    && !contract.endedAt
    && contract.application?.status === 'REJECTED'
    && !contract.freelanceDetails?.completionSubmittedAt
    && !contract.freelanceDetails?.employerConfirmedAt
    && !contract.freelanceDetails?.seekerConfirmedAt
    && !contract.freelanceDetails?.employerCompletionConfirmedAt
    && contract.freelanceDetails?.workStatus === 'CANCELLED'
    && contractAssociationsMatch(contract)
    && contractTypeMatchesJob(contract)
    && (!escrow || (escrow.status === 'CANCELLED' && Boolean(escrow.cancelledAt)))
    && !escrowHasFinancialActivity(escrow);
  return validLifecycle
    && await hasNoContractFinancialHistory(client, contract.id, escrow?.id, contract.employerId);
};

export const canReapplyAfterCancelledContracts = async (client, applications) => {
  if (applications.length === 0) return false;
  const cancelledSafely = await Promise.all(applications.map((application) => (
    application.contract
      ? isSafelyCancelledContract(client, application.contract)
      : false
  )));
  return cancelledSafely.every(Boolean);
};

class ContractDeletionError extends Error {
  constructor(message = 'This contract has an unresolved financial or lifecycle state and cannot be deleted.') {
    super(message);
    this.name = 'ContractDeletionError';
    this.status = 409;
    this.publicMessage = message;
  }
}

const isSafelyReleasedContract = async (client, contract, allowedContractStatuses = ['ACTIVE', 'IN_PROGRESS']) => {
  const details = contract.freelanceDetails;
  const escrow = details?.escrow;
  const expectedEscrowFundingAmount = details ? fundingPaymentAmount(details) : null;
  if (!escrow
    || !expectedEscrowFundingAmount
    || !['FREELANCE_PROJECT', 'CONTRACT_PROJECT'].includes(contract.type)
    || !allowedContractStatuses.includes(contract.status)
    || details.workStatus !== 'RELEASED'
    || !details.completionSubmittedAt
    || !details.employerCompletionConfirmedAt
    || !contractAssociationsMatch(contract)
    || !contractTypeMatchesJob(contract)
    || escrow.status !== 'RELEASED'
    || !escrow.fundedAt
    || !escrow.releaseEligibleAt
    || !escrow.releasedAt
    || Boolean(escrow.cancelledAt)
    || escrow.currency !== details.currency
    || !new Prisma.Decimal(expectedEscrowFundingAmount).eq(escrow.grossAmount)
    || !new Prisma.Decimal(escrow.fundedAmount ?? 0).eq(escrow.grossAmount)
    || !new Prisma.Decimal(escrow.releasedAmount ?? 0).eq(escrow.seekerNetAmount)
    || !new Prisma.Decimal(escrow.refundedAmount ?? 0).isZero()
    || (contract.disputes ?? []).length > 0
    || (escrow.disputes ?? []).length > 0
    || (escrow.refunds ?? []).some((refund) => !['FAILED', 'CANCELLED'].includes(refund.status))
    || escrow.conversionOperation
    || (escrow.payments ?? []).some((payment) => ['PENDING', 'PROCESSING'].includes(payment.status))) {
    return false;
  }

  const successfulEscrowPayments = (escrow.payments ?? []).filter((payment) => payment.status === 'SUCCESSFUL');
  if (successfulEscrowPayments.length !== 1) return false;

  const expectedFundingAmount = new Prisma.Decimal(escrow.seekerNetAmount).eq(escrow.grossAmount)
    ? new Prisma.Decimal(escrow.grossAmount).plus(escrow.platformFeeAmount)
    : new Prisma.Decimal(escrow.grossAmount);
  const verifiedFundingPayment = (escrow.payments ?? []).some((payment) => (
    payment.paymentType === 'CONTRACT_FUNDING'
    && payment.status === 'SUCCESSFUL'
    && Boolean(payment.verifiedAt)
    && typeof payment.transactionId === 'string'
    && payment.transactionId.trim() !== ''
    && payment.currency === escrow.currency
    && new Prisma.Decimal(payment.amount).eq(expectedFundingAmount)
  ));
  if (!verifiedFundingPayment) return false;

  const [relatedPayments, inProgressEscrowPayment, pendingWebhook, releaseLedgerEntry, releaseAudit] = await Promise.all([
    findContractFundingPayments(client, contract.id),
    client.payment.findFirst({
      where: { escrowId: escrow.id, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true },
    }),
    hasPendingContractWebhook(client, contract.id),
    client.financialLedgerEntry.findFirst({
      where: {
        contractId: contract.id,
        escrowId: escrow.id,
        entryType: 'WALLET_CREDIT',
        idempotencyKey: `escrow:${escrow.id}:release`,
        amount: escrow.seekerNetAmount,
        currency: escrow.currency,
      },
      select: { id: true },
    }),
    client.financialAuditLog.findFirst({
      where: {
        entityType: 'ESCROW',
        entityId: escrow.id,
        action: 'RELEASED',
        fromStatus: 'RELEASE_ELIGIBLE',
        toStatus: 'RELEASED',
        amount: escrow.seekerNetAmount,
        currency: escrow.currency,
      },
      select: { id: true },
    }),
  ]);
  const successfulRelatedPayments = relatedPayments.filter((payment) => payment.status === 'SUCCESSFUL');
  return successfulRelatedPayments.length === 1
    && successfulRelatedPayments[0].id === successfulEscrowPayments[0].id
    && !relatedPayments.some((payment) => ['PENDING', 'PROCESSING'].includes(payment.status))
    && !inProgressEscrowPayment
    && !pendingWebhook
    && Boolean(releaseLedgerEntry)
    && Boolean(releaseAudit);
};

const isSafelyCompletedContract = async (client, contract) => {
  const details = contract.freelanceDetails;
  const escrow = details?.escrow;
  if (!['ACTIVE', 'IN_PROGRESS'].includes(contract.status)
    || contract.endedAt
    || contract.cancelledAt
    || contract.employerArchivedAt
    || details?.workStatus !== 'RELEASED'
    || !details.completionSubmittedAt
    || !details.employerCompletionConfirmedAt
    || !escrow
    || !details.seekerNetAmount
    || details.platformFeeAmount === null
    || details.platformFeeAmount === undefined
    || new Prisma.Decimal(details.seekerNetAmount).lte(0)
    || new Prisma.Decimal(details.platformFeeAmount).lt(0)
    || new Prisma.Decimal(escrow.grossAmount).lte(0)
    || !new Prisma.Decimal(details.seekerNetAmount).eq(escrow.seekerNetAmount)
    || !new Prisma.Decimal(details.platformFeeAmount).eq(escrow.platformFeeAmount)
    || !new Prisma.Decimal(escrow.releasedAmount ?? 0)
      .plus(escrow.platformFeeAmount)
      .eq(escrow.grossAmount)) {
    return false;
  }
  return isSafelyReleasedContract(client, contract, ['ACTIVE', 'IN_PROGRESS']);
};

const isEligibleForEmployerDeletion = async (client, contract, cancellationHistoryClear = false) => {
  if (contract.employerArchivedAt) return false;
  if (contract.freelanceDetails?.escrow?.conversionOperation) return false;
  if (contract.status === 'CANCELLED' || canPossiblyCancelContract(contract)) {
    const lifecycleIsSafe = contract.status === 'CANCELLED'
      ? await isSafelyCancelledContract(client, contract)
      : cancellationHistoryClear;
    if (!lifecycleIsSafe) return false;
    const pendingWebhook = await hasPendingContractWebhook(client, contract.id);
    return !pendingWebhook;
  }
  return isSafelyReleasedContract(client, contract);
};

const contractActions = (contract, cancellationHistoryClear = false, deletionAvailable = false) => {
  const details = contract.freelanceDetails;
  const escrow = details?.escrow;
  const payments = escrow?.payments ?? [];
  const contractHasFinancialActivity = (contract.disputes ?? []).length > 0
    || (contract.ledgerEntries ?? []).length > 0;
  const hasEscrowFinancialActivity = escrowHasFinancialActivity(escrow);
  const fundableStatus = contract.type === 'CONTRACT_PROJECT'
    ? contract.status === 'PENDING'
    : contract.type === 'FREELANCE_PROJECT' && ['PENDING', 'ACTIVE'].includes(contract.status);
  return {
    fund: Boolean(fundableStatus && escrow && ['UNFUNDED', 'FUNDING'].includes(escrow.status)),
    cancel: Boolean(
      canPossiblyCancelContract(contract)
      && !contractHasFinancialActivity
      && cancellationHistoryClear
      && (escrow
        ? escrow.status === 'UNFUNDED'
          && !hasEscrowFinancialActivity
          && payments.length === 0
        : true),
    ),
    confirmCompletion: Boolean(
      contract.status === 'ACTIVE'
      && escrow?.status === 'FUNDED'
      && details?.completionSubmittedAt
      && !details?.employerCompletionConfirmedAt
      && (escrow.payments ?? []).some((payment) => payment.status === 'SUCCESSFUL'),
    ),
    delete: deletionAvailable,
  };
};

export const isContractCancellationAvailable = (contract, cancellationHistoryClear) => (
  contractActions(contract, cancellationHistoryClear).cancel
);

export const mapContract = (contract, { cancellationHistoryClear = false, deletionAvailable = false } = {}) => ({
  id: contract.id,
  contractId: contract.id,
  applicationId: contract.applicationId,
  jobId: contract.jobId,
  employerId: contract.employerId,
  seekerId: contract.seekerId,
  type: contract.type,
  status: contract.status,
  startDate: contract.startDate,
  expectedEndDate: contract.expectedEndDate,
  completedAt: contract.completedAt ?? null,
  endedAt: contract.endedAt ?? null,
  cancelledAt: contract.cancelledAt ?? null,
  employerArchivedAt: contract.employerArchivedAt ?? null,
  job: contract.job,
  application: contract.application ?? null,
  employer: contract.employer,
  seeker: contract.seeker ? {
    id: contract.seeker.id,
    firstName: contract.seeker.firstName,
    lastName: contract.seeker.lastName,
    professionalTitle: contract.seeker.seekerProfile?.professionalTitle ?? null,
    profilePictureUrl: contract.seeker.seekerProfile?.profilePictureUrl ?? null,
  } : null,
  createdAt: contract.createdAt,
  updatedAt: contract.updatedAt,
  freelance: contract.freelanceDetails ? {
    id: contract.freelanceDetails.id,
    agreedAmount: decimalToString(contract.freelanceDetails.agreedAmount),
    currency: contract.freelanceDetails.currency,
    duration: contract.freelanceDetails.duration,
    startMode: contract.freelanceDetails.startMode,
    platformFeePercentage: decimalToString(contract.freelanceDetails.platformFeePercentage),
    platformFeeAmount: decimalToString(contract.freelanceDetails.platformFeeAmount),
    seekerNetAmount: decimalToString(contract.freelanceDetails.seekerNetAmount),
    employerConfirmedAt: contract.freelanceDetails.employerConfirmedAt,
    seekerConfirmedAt: contract.freelanceDetails.seekerConfirmedAt,
    employerCompletionConfirmedAt: contract.freelanceDetails.employerCompletionConfirmedAt,
    completionSubmittedAt: contract.freelanceDetails.completionSubmittedAt,
    completionNote: contract.freelanceDetails.completionNote,
    workStatus: contract.freelanceDetails.workStatus,
    expectedCompletionDate: contract.freelanceDetails.expectedCompletionDate ?? null,
    escrow: contract.freelanceDetails.escrow ? {
      id: contract.freelanceDetails.escrow.id,
      grossAmount: decimalToString(contract.freelanceDetails.escrow.grossAmount),
      platformFeeAmount: decimalToString(contract.freelanceDetails.escrow.platformFeeAmount),
      seekerNetAmount: decimalToString(contract.freelanceDetails.escrow.seekerNetAmount),
      currency: contract.freelanceDetails.escrow.currency,
      fundedAmount: decimalToString(contract.freelanceDetails.escrow.fundedAmount),
      releasedAmount: decimalToString(contract.freelanceDetails.escrow.releasedAmount),
      refundedAmount: decimalToString(contract.freelanceDetails.escrow.refundedAmount),
      status: contract.freelanceDetails.escrow.status,
      fundedAt: contract.freelanceDetails.escrow.fundedAt,
      releaseEligibleAt: contract.freelanceDetails.escrow.releaseEligibleAt,
      releasedAt: contract.freelanceDetails.escrow.releasedAt ?? null,
      cancelledAt: contract.freelanceDetails.escrow.cancelledAt ?? null,
      payments: (contract.freelanceDetails.escrow.payments ?? []).map((payment) => ({
        id: payment.id,
        amount: decimalToString(payment.amount),
        currency: payment.currency,
        transactionId: payment.transactionId,
        status: payment.status,
        paymentType: payment.paymentType,
        provider: payment.provider ?? null,
        providerReference: payment.providerReference ?? null,
        verifiedAt: payment.verifiedAt,
        createdAt: payment.createdAt,
      })),
    } : null,
  } : null,
  funding: contract.freelanceDetails ? {
    projectAmount: decimalToString(contract.freelanceDetails.agreedAmount),
    percentage: decimalToString(contract.freelanceDetails.platformFeePercentage),
    feeAmount: decimalToString(contract.freelanceDetails.platformFeeAmount),
    totalEmployerPayment: contract.freelanceDetails.escrow?.payments?.[0]?.amount
      ? decimalToString(contract.freelanceDetails.escrow.payments[0].amount)
      : fundingPaymentAmount(contract.freelanceDetails),
    seekerEntitlement: decimalToString(contract.freelanceDetails.seekerNetAmount),
    currency: contract.freelanceDetails.currency,
    fundedAmount: decimalToString(contract.freelanceDetails.escrow?.fundedAmount),
    escrowStatus: contract.freelanceDetails.escrow?.status ?? null,
    paymentStatus: contract.freelanceDetails.escrow?.payments?.[0]?.status ?? null,
  } : null,
  availableActions: contractActions(contract, cancellationHistoryClear, deletionAvailable),
});

const isEligibleForAdminArchive = async (client, contract, cancellationHistoryClear = false) => {
  if (contract.status === 'COMPLETED') return isSafelyCompletedContract(client, contract);
  return contract.status !== 'DISPUTED'
    && contract.freelanceDetails?.escrow?.status !== 'DISPUTED'
    && (contract.disputes ?? []).length === 0
    && (contract.freelanceDetails?.escrow?.disputes ?? []).length === 0
    && await isEligibleForEmployerDeletion(client, contract, cancellationHistoryClear);
};

const adminActionAvailability = async (client, contract) => {
  const cleanCancellationLifecycle = canPossiblyCancelContract(contract);
  const [historyClear, pendingWebhook] = cleanCancellationLifecycle
    ? await Promise.all([
      hasNoContractFinancialHistory(
        client,
        contract.id,
        contract.freelanceDetails?.escrow?.id,
        contract.employerId,
      ),
      hasPendingContractWebhook(client, contract.id),
    ])
    : [false, null];
  const cancellationHistoryClear = cleanCancellationLifecycle
    && historyClear
    && !pendingWebhook;
  const archiveAvailable = await isEligibleForAdminArchive(client, contract, cancellationHistoryClear);

  return {
    cancellationHistoryClear: cancellationHistoryClear
      && !contract.employerArchivedAt
      && contract.application?.status !== 'PAYMENT_PENDING'
      && contract.status !== 'DISPUTED'
      && (contract.disputes ?? []).length === 0,
    archiveAvailable,
  };
};

const mapAdminContract = (contract, actions) => {
  const mapped = mapContract(contract, {
    cancellationHistoryClear: actions.cancellationHistoryClear,
    deletionAvailable: actions.archiveAvailable,
  });

  return {
    ...mapped,
    availableActions: {
      ...mapped.availableActions,
      cancel: mapped.availableActions.cancel && actions.cancellationHistoryClear,
      delete: false,
      archive: actions.archiveAvailable,
    },
  };
};

const adminContractSearchWhere = (search) => ({
  OR: [
    { id: { contains: search, mode: 'insensitive' } },
    { job: { is: { title: { contains: search, mode: 'insensitive' } } } },
    { employer: { is: { OR: [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ] } } },
    { seeker: { is: { OR: [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ] } } },
  ],
});

export const listAdminContracts = async ({
  page = 1,
  limit = 20,
  status,
  escrowStatus,
  workStatus,
  search,
}) => {
  const where = {
    ...(status ? { status } : {}),
    ...(search ? adminContractSearchWhere(search) : {}),
    ...((escrowStatus || workStatus) ? {
      freelanceDetails: {
        is: {
          ...(workStatus ? { workStatus } : {}),
          ...(escrowStatus ? { escrow: { is: { status: escrowStatus } } } : {}),
        },
      },
    } : {}),
  };
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      select: contractSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contract.count({ where }),
  ]);
  const mappedContracts = await Promise.all(contracts.map(async (contract) => {
    const actions = await adminActionAvailability(prisma, contract);
    const mapped = mapAdminContract(contract, actions);

    return {
      id: mapped.id,
      contractId: mapped.contractId,
      applicationId: mapped.applicationId,
      jobId: mapped.jobId,
      employerId: mapped.employerId,
      seekerId: mapped.seekerId,
      type: mapped.type,
      status: mapped.status,
      startDate: mapped.startDate,
      expectedEndDate: mapped.expectedEndDate,
      completedAt: mapped.completedAt,
      endedAt: mapped.endedAt,
      cancelledAt: mapped.cancelledAt,
      employerArchivedAt: mapped.employerArchivedAt,
      job: { id: mapped.job.id, title: mapped.job.title },
      employer: mapped.employer ? {
        id: mapped.employer.id,
        firstName: mapped.employer.firstName,
        lastName: mapped.employer.lastName,
      } : null,
      seeker: mapped.seeker ? {
        id: mapped.seeker.id,
        firstName: mapped.seeker.firstName,
        lastName: mapped.seeker.lastName,
        professionalTitle: mapped.seeker.professionalTitle,
      } : null,
      createdAt: mapped.createdAt,
      updatedAt: mapped.updatedAt,
      funding: mapped.funding,
      freelance: mapped.freelance ? {
        id: mapped.freelance.id,
        agreedAmount: mapped.freelance.agreedAmount,
        currency: mapped.freelance.currency,
        workStatus: mapped.freelance.workStatus,
        escrow: mapped.freelance.escrow ? {
          id: mapped.freelance.escrow.id,
          grossAmount: mapped.freelance.escrow.grossAmount,
          fundedAmount: mapped.freelance.escrow.fundedAmount,
          releasedAmount: mapped.freelance.escrow.releasedAmount,
          refundedAmount: mapped.freelance.escrow.refundedAmount,
          currency: mapped.freelance.escrow.currency,
          status: mapped.freelance.escrow.status,
          fundedAt: mapped.freelance.escrow.fundedAt,
          releaseEligibleAt: mapped.freelance.escrow.releaseEligibleAt,
          releasedAt: mapped.freelance.escrow.releasedAt,
          cancelledAt: mapped.freelance.escrow.cancelledAt,
        } : null,
      } : null,
      availableActions: mapped.availableActions,
    };
  }));

  return {
    contracts: mappedContracts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminContractById = async (contractId) => {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: contractSelect });
  if (!contract) throw new ContractNotFoundError();
  return mapAdminContract(contract, await adminActionAvailability(prisma, contract));
};

const lockContract = async (transaction, contractId) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Contract"
    WHERE "id" = ${contractId}
    FOR UPDATE
  `;

  return transaction.contract.findUnique({
    where: { id: contractId },
    select: contractSelect,
  });
};

const lockAdminArchiveFinancialRecords = async (transaction, contract) => {
  const contractId = contract.id;
  const escrowId = contract.freelanceDetails?.escrow?.id ?? null;
  const employerId = contract.employerId;
  const providerReferencePrefix = `leamjobs_${contractId}_`;

  await transaction.$queryRaw`
    SELECT "id"
    FROM "Payment"
    WHERE "escrowId" = ${escrowId}
      OR "metadata" ->> 'contractId' = ${contractId}
      OR LEFT("providerReference", ${providerReferencePrefix.length}::int4) = ${providerReferencePrefix}
      OR ("userId" = ${employerId} AND "paymentType" = 'CONTRACT_FUNDING' AND "escrowId" IS NULL)
    FOR UPDATE
  `;
  if (escrowId) {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Refund"
      WHERE "escrowId" = ${escrowId}
      FOR UPDATE
    `;
  }
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Dispute"
    WHERE "contractId" = ${contractId}
      OR "escrowId" = ${escrowId}
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "FinancialLedgerEntry"
    WHERE "contractId" = ${contractId}
      OR "escrowId" = ${escrowId}
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "FinancialAuditLog"
    WHERE ("entityType" = 'CONTRACT' AND "entityId" = ${contractId})
      OR ("entityType" = 'ESCROW' AND "entityId" = ${escrowId})
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "ProviderWebhookEvent"
    WHERE "contractId" = ${contractId}
      OR LEFT("paymentReference", ${providerReferencePrefix.length}::int4) = ${providerReferencePrefix}
    FOR UPDATE
  `;
};

const archiveContract = async ({ contractId, employerId, adminId }) => {
  const archiveTransaction = async (transaction) => {
    const contractWhere = { id: contractId, ...(employerId ? { employerId } : {}) };
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${contractId}
        AND (${employerId ?? null}::text IS NULL OR "employerId" = ${employerId ?? null})
      FOR UPDATE
    `;
    let contract = await transaction.contract.findFirst({ where: contractWhere, select: contractSelect });
    if (!contract) throw new ContractNotFoundError();
    if (contract.employerArchivedAt) {
      return adminId
        ? { archived: true, alreadyArchived: true }
        : { deleted: true, alreadyDeleted: true };
    }

    const escrowId = contract.freelanceDetails?.escrow?.id;
    if (escrowId) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Escrow"
        WHERE "id" = ${escrowId}
        FOR UPDATE
      `;
      contract = await transaction.contract.findFirst({ where: contractWhere, select: contractSelect });
      if (!contract) throw new ContractNotFoundError();
      if (contract.employerArchivedAt) {
        return adminId
          ? { archived: true, alreadyArchived: true }
          : { deleted: true, alreadyDeleted: true };
      }
    }

    if (adminId) {
      await lockAdminArchiveFinancialRecords(transaction, contract);
      contract = await transaction.contract.findFirst({ where: contractWhere, select: contractSelect });
      if (!contract) throw new ContractNotFoundError();
      if (contract.employerArchivedAt) return { archived: true, alreadyArchived: true };
    }

    const cancellationHistoryClear = canPossiblyCancelContract(contract)
      && await hasNoContractFinancialHistory(
        transaction,
        contract.id,
        contract.freelanceDetails?.escrow?.id,
        contract.employerId,
      );
    const eligible = adminId
      ? await isEligibleForAdminArchive(transaction, contract, cancellationHistoryClear)
      : await isEligibleForEmployerDeletion(transaction, contract, cancellationHistoryClear);
    if (!eligible) {
      throw adminId
        ? new ContractDeletionError('This contract is not eligible for safe archiving. Refresh the contract and review its current lifecycle state.')
        : new ContractDeletionError();
    }

    const archivedAt = new Date();
    await transaction.contract.update({
      where: { id: contract.id },
      data: { employerArchivedAt: archivedAt },
      select: { id: true },
    });
    if (adminId) {
      await transaction.adminAuditEvent.create({
        data: {
          actorId: adminId,
          subjectId: contract.employerId,
          action: 'ADMIN_CONTRACT_ARCHIVED',
          entityType: 'CONTRACT',
          entityId: contract.id,
          before: { employerArchivedAt: null, status: contract.status },
          after: { employerArchivedAt: archivedAt.toISOString(), status: contract.status },
        },
      });
      return { archived: true, alreadyArchived: false };
    }
    return { deleted: true, alreadyDeleted: false };
  };

  if (!adminId) return prisma.$transaction(archiveTransaction);
  try {
    return await prisma.$transaction(archiveTransaction, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error?.code === 'P2034') {
      throw new ContractDeletionError('The contract financial state changed during archive review. Refresh the contract and try again.');
    }
    throw error;
  }
};

export const archiveEmployerContract = ({ contractId, employerId }) => (
  archiveContract({ contractId, employerId })
);

export const archiveAdminContract = ({ contractId, adminId }) => (
  archiveContract({ contractId, adminId })
);

export const getContractForParty = async ({ contractId, userId, role }) => {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: contractSelect });
  if (!contract) throw new ContractNotFoundError();
  const ownerId = role === 'EMPLOYER' ? contract.employerId : contract.seekerId;
  if (ownerId !== userId || (role === 'EMPLOYER' && contract.employerArchivedAt)) throw new ContractNotFoundError();
  const cancellationHistoryClear = role === 'EMPLOYER'
    && canPossiblyCancelContract(contract)
    && await hasNoContractFinancialHistory(prisma, contract.id, contract.freelanceDetails?.escrow?.id, contract.employerId);
  return mapContract(contract, { cancellationHistoryClear });
};

const cancelContract = async ({ contractId, employerId, adminId, applicationJobId }) => {
  const existing = await prisma.contract.findFirst({
    where: { id: contractId, ...(employerId ? { employerId } : {}), ...(applicationJobId ? { jobId: applicationJobId } : {}) },
    select: { id: true, jobId: true, applicationId: true, employerId: true },
  });
  if (!existing) throw new ContractNotFoundError();
  const contractEmployerId = existing.employerId;
  const actorUserId = adminId ?? employerId;

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Job"
      WHERE "id" = ${existing.jobId}
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${contractId} AND "employerId" = ${contractEmployerId}
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Application"
      WHERE "id" = ${existing.applicationId}
      FOR UPDATE
    `;

    const contract = await transaction.contract.findFirst({
      where: { id: contractId, employerId: contractEmployerId, jobId: existing.jobId },
      select: {
        ...contractSelect,
        job: { select: { id: true, employerId: true, title: true, description: true, jobType: true, engagementType: true } },
        application: { select: { id: true, jobId: true, seekerId: true, status: true, createdAt: true } },
        freelanceDetails: {
          select: {
            workStatus: true,
            contractId: true,
            completionSubmittedAt: true,
            employerConfirmedAt: true,
            seekerConfirmedAt: true,
            employerCompletionConfirmedAt: true,
            agreedAmount: true,
            currency: true,
            escrow: {
              select: {
                id: true,
                freelanceContractId: true,
                status: true,
                fundedAmount: true,
                releasedAmount: true,
                refundedAmount: true,
                fundedAt: true,
                releasedAt: true,
                cancelledAt: true,
                releaseEligibleAt: true,
                payments: { select: { id: true, status: true, paymentType: true } },
                refunds: { select: { id: true } },
                disputes: { select: { id: true } },
                ledgerEntries: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!contract) throw new ContractNotFoundError();
    if (adminId && contract.application?.status === 'PAYMENT_PENDING') {
      throw new FreelanceContractCancellationError('Payment-pending contracts cannot be cancelled by an administrator.');
    }
    if (contract.status === 'CANCELLED' && await isSafelyCancelledContract(transaction, contract)) return;
    if (!canPossiblyCancelContract(contract)) {
      throw new FreelanceContractCancellationError('This contract is no longer eligible for cancellation.');
    }

    let escrow = null;
    if (contract.freelanceDetails.escrow) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Escrow"
        WHERE "id" = ${contract.freelanceDetails.escrow.id}
        FOR UPDATE
      `;
      escrow = await transaction.escrow.findUnique({
        where: { id: contract.freelanceDetails.escrow.id },
        select: {
          id: true,
          freelanceContractId: true,
          status: true,
          fundedAmount: true,
          releasedAmount: true,
          refundedAmount: true,
          fundedAt: true,
          releasedAt: true,
          cancelledAt: true,
          releaseEligibleAt: true,
          payments: { select: { id: true, status: true, paymentType: true } },
          refunds: { select: { id: true } },
          disputes: { select: { id: true } },
          ledgerEntries: { select: { id: true } },
        },
      });
      if (!escrow) throw new FreelanceContractCancellationError('The contract escrow is unavailable.');
      if (escrow.freelanceContractId !== contract.id) {
        throw new FreelanceContractCancellationError('The contract escrow is linked to inconsistent work history.');
      }
      if (!hasConsistentUnfundedEscrow(escrow)) {
        throw new FreelanceContractCancellationError('The contract escrow has contradictory lifecycle or financial history.');
      }
    }

    const relatedFundingPayments = await findContractFundingPayments(transaction, contractId, { lock: true });
    const escrowPayments = escrow
      ? await transaction.payment.findFirst({ where: { escrowId: escrow.id }, select: { id: true } })
      : null;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Payment"
      WHERE "userId" = ${contractEmployerId}
        AND "paymentType" = 'CONTRACT_FUNDING'
        AND "escrowId" IS NULL
      FOR UPDATE
    `;
    const unlinkedFundingPayment = await transaction.payment.findFirst({
      where: { userId: contractEmployerId, paymentType: 'CONTRACT_FUNDING', escrowId: null },
      select: { id: true },
    });
    if (relatedFundingPayments.length > 0 || escrowPayments || unlinkedFundingPayment || (escrow?.payments.length ?? 0) > 0) {
      throw new FreelanceContractCancellationError(
        'This contract has a payment attempt on record. A provider may still report a late result, so resolve the payment state before cancelling.',
      );
    }

    const providerReferencePrefix = `leamjobs_${contractId}_`;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "ProviderWebhookEvent"
      WHERE "contractId" = ${contractId}
        OR LEFT("paymentReference", ${providerReferencePrefix.length}::int4) = ${providerReferencePrefix}
      FOR UPDATE
    `;
    if (await hasPendingContractWebhook(transaction, contractId)) {
      throw new FreelanceContractCancellationError(
        'This contract has an unprocessed payment-provider event. Resolve the event before cancelling.',
      );
    }

    const [contractLedgerEntry, contractDispute, financialAuditLog] = await Promise.all([
      transaction.financialLedgerEntry.findFirst({
        where: { OR: [{ contractId }, ...(escrow ? [{ escrowId: escrow.id }] : [])] },
        select: { id: true },
      }),
      transaction.dispute.findFirst({
        where: { OR: [{ contractId }, ...(escrow ? [{ escrowId: escrow.id }] : [])] },
        select: { id: true },
      }),
      transaction.financialAuditLog.findFirst({
        where: {
          entityType: { in: ['CONTRACT', ...(escrow ? ['ESCROW'] : [])] },
          entityId: { in: [contractId, ...(escrow ? [escrow.id] : [])] },
          action: { notIn: ['CREATED', 'CANCELLED'] },
        },
        select: { id: true },
      }),
    ]);
    const hasContractFinancialActivity = Boolean(contractLedgerEntry || contractDispute || financialAuditLog);
    const hasEscrowFinancialActivity = escrow && (
      new Prisma.Decimal(escrow.fundedAmount).gt(0)
      || new Prisma.Decimal(escrow.releasedAmount).gt(0)
      || new Prisma.Decimal(escrow.refundedAmount).gt(0)
      || Boolean(escrow.fundedAt || escrow.releasedAt || escrow.releaseEligibleAt)
      || escrow.refunds.length > 0
      || escrow.disputes.length > 0
      || escrow.ledgerEntries.length > 0
    );
    if (hasContractFinancialActivity || hasEscrowFinancialActivity || (escrow && escrow.status !== 'UNFUNDED')) {
      throw new FreelanceContractCancellationError(
        'This contract has financial activity or is no longer unfunded. Use its existing payment and escrow workflow instead.',
      );
    }

    const cancelledAt = new Date();
    await transaction.contract.update({
      where: { id: contract.id },
      data: { status: 'CANCELLED', cancelledAt },
    });
    await transaction.freelanceContract.update({
      where: { contractId: contract.id },
      data: { workStatus: 'CANCELLED' },
    });
    if (escrow) {
      await transaction.escrow.update({
        where: { id: escrow.id },
        data: { status: 'CANCELLED', cancelledAt },
      });
    }
    await transaction.application.update({
      where: { id: contract.applicationId },
      data: { status: 'REJECTED' },
    });
    if (adminId) {
      await transaction.financialAuditLog.create({
        data: {
          actorUserId: adminId,
          entityType: 'CONTRACT',
          entityId: contract.id,
          action: 'CANCELLED',
          fromStatus: contract.status,
          toStatus: 'CANCELLED',
          reason: 'Authorized administrator cancelled an eligible unfunded contract',
        },
      });
    }
    await createNotification({
      recipientUserId: contract.seekerId,
      actorUserId,
      type: 'WARNING',
      category: 'CONTRACT',
      eventKey: `contract:cancelled:${contract.id}`,
      title: 'Contract cancelled before funding',
      message: `${adminId ? 'An administrator' : 'The employer'} cancelled the unfunded contract for ${contract.job?.title ?? 'the project'}.`,
      link: '/seeker/applications',
    }, transaction);
  });

  if (adminId) return getAdminContractById(contractId);
  return getContractForParty({ contractId, userId: employerId, role: 'EMPLOYER' });
};

export const cancelEmployerFreelanceContract = (options) => cancelContract(options);

export const cancelAdminContract = ({ contractId, adminId }) => (
  cancelContract({ contractId, adminId })
);

export const listEmployerContracts = async ({ employerId, page, limit, status }) => {
  const where = {
    employerId,
    employerArchivedAt: null,
    ...(status ? { status } : {}),
  };
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      select: contractSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contract.count({ where }),
  ]);
  const mappedContracts = await Promise.all(contracts.map(async (contract) => {
    const cancellationHistoryClear = canPossiblyCancelContract(contract)
      && await hasNoContractFinancialHistory(prisma, contract.id, contract.freelanceDetails?.escrow?.id, employerId);
    const deletionAvailable = await isEligibleForEmployerDeletion(prisma, contract, cancellationHistoryClear);
    return mapContract(contract, { cancellationHistoryClear, deletionAvailable });
  }));
  return {
    contracts: mappedContracts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const confirmContract = async ({ contractId, userId, role }) => {
  return prisma.$transaction(async (transaction) => {
    const contract = await lockContract(transaction, contractId);
    if (!contract) throw new ContractNotFoundError();

    const isEmployer = role === 'EMPLOYER';
    const ownsContract = isEmployer ? contract.employerId === userId : contract.seekerId === userId;
    if (!ownsContract) throw new ContractNotFoundError();
    const mapConfirmedContract = async (value) => {
      const cancellationHistoryClear = isEmployer
        && canPossiblyCancelContract(value)
        && await hasNoContractFinancialHistory(transaction, value.id, value.freelanceDetails?.escrow?.id, value.employerId);
      return mapContract(value, { cancellationHistoryClear });
    };

    if (contract.status === 'ACTIVE') return mapConfirmedContract(contract);
    if (contract.status !== 'PENDING') {
      throw new ContractConfirmationError('This contract cannot be confirmed in its current state');
    }
    if (contract.type === 'CONTRACT_PROJECT') {
      throw new ContractConfirmationError('Contract Jobs are activated after verified payment');
    }
    if (!contract.freelanceDetails) {
      throw new ContractConfirmationError('Freelance contract details are unavailable');
    }

    const hasFeeSnapshot = [
      contract.freelanceDetails.platformFeePercentage,
      contract.freelanceDetails.platformFeeAmount,
      contract.freelanceDetails.seekerNetAmount,
    ].every((value) => value !== null && value !== undefined);
    if (!hasFeeSnapshot) {
      throw new ContractConfirmationError('This contract is missing its fee snapshot and cannot be confirmed');
    }

    const alreadyConfirmed = isEmployer
      ? Boolean(contract.freelanceDetails.employerConfirmedAt)
      : Boolean(contract.freelanceDetails.seekerConfirmedAt);
    if (alreadyConfirmed) return mapConfirmedContract(contract);

    const confirmedAt = new Date();
    const updatedFreelance = await transaction.freelanceContract.update({
      where: { contractId: contract.id },
      data: isEmployer
        ? { employerConfirmedAt: confirmedAt }
        : { seekerConfirmedAt: confirmedAt },
      select: {
        ...contractSelect.freelanceDetails.select,
        escrow: false,
      },
    });

    const bothConfirmed = Boolean(updatedFreelance.employerConfirmedAt && updatedFreelance.seekerConfirmedAt);
    let updatedContract = contract;
    let escrow = contract.freelanceDetails.escrow;

    if (bothConfirmed) {
      updatedContract = await transaction.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE' },
        select: contractSelect,
      });

      if (!escrow) {
        escrow = await transaction.escrow.create({
          data: {
            freelanceContractId: contract.id,
            grossAmount: new Prisma.Decimal(contract.freelanceDetails.agreedAmount),
            platformFeeAmount: new Prisma.Decimal(contract.freelanceDetails.platformFeeAmount),
            seekerNetAmount: new Prisma.Decimal(contract.freelanceDetails.seekerNetAmount),
            currency: contract.freelanceDetails.currency,
            fundedAmount: new Prisma.Decimal('0.00'),
            releasedAmount: new Prisma.Decimal('0.00'),
            refundedAmount: new Prisma.Decimal('0.00'),
            status: 'UNFUNDED',
          },
          select: contractSelect.freelanceDetails.select.escrow.select,
        });
      }

      await Promise.all([
        createNotification({
          recipientUserId: contract.employerId,
          type: 'SUCCESS',
          category: 'CONTRACT',
          eventKey: `contract:active:${contract.id}`,
          title: 'Contract is active',
          message: `The contract for ${contract.job?.title ?? 'your contract'} is now active.`,
          link: `/employer/contracts/${contract.id}`,
        }, transaction).catch(() => undefined),
        createNotification({
          recipientUserId: contract.seekerId,
          type: 'SUCCESS',
          category: 'CONTRACT',
          eventKey: `contract:active:${contract.id}`,
          title: 'Contract is active',
          message: `The contract for ${contract.job?.title ?? 'your contract'} is now active.`,
          link: `/seeker/contracts/${contract.id}`,
        }, transaction).catch(() => undefined),
      ]);
    } else {
      updatedContract = await transaction.contract.findUnique({
        where: { id: contract.id },
        select: contractSelect,
      });
    }

    return mapConfirmedContract({
      ...updatedContract,
      freelanceDetails: {
        ...(updatedContract.freelanceDetails ?? contract.freelanceDetails),
        ...updatedFreelance,
        escrow,
      },
    });
  });
};

const lockProgressContract = async (transaction, contractId) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Contract"
    WHERE "id" = ${contractId}
    FOR UPDATE
  `;
  return transaction.contract.findUnique({ where: { id: contractId }, select: contractSelect });
};

const assertFundedContract = (contract) => {
  if (!contract || contract.status !== 'ACTIVE' || !contract.freelanceDetails?.escrow) {
    throw new ContractProgressError('This contract is not available for completion');
  }
  if (contract.freelanceDetails.escrow.status !== 'FUNDED') {
    throw new ContractProgressError('The escrow must be funded before work can be completed');
  }
  if (!(contract.freelanceDetails.escrow.payments ?? []).some((payment) => payment.status === 'SUCCESSFUL')) {
    throw new ContractProgressError('A verified payment is required before completion');
  }
};

export const submitContractCompletion = async ({ contractId, seekerId, completionNote }) => {
  return prisma.$transaction(async (transaction) => {
    const contract = await lockProgressContract(transaction, contractId);
    if (!contract || contract.seekerId !== seekerId) throw new ContractNotFoundError();
    assertFundedContract(contract);
    if (contract.freelanceDetails.completionSubmittedAt) return mapContract(contract);

    await transaction.freelanceContract.update({
      where: { contractId },
      data: {
        completionNote: completionNote?.trim() || null,
        completionSubmittedAt: new Date(),
        workStatus: 'COMPLETION_SUBMITTED',
      },
    });
    await createNotification({
      recipientUserId: contract.employerId,
      actorUserId: seekerId,
      type: 'INFO',
      category: 'CONTRACT',
      eventKey: `contract:completion-submitted:${contract.id}`,
      title: 'Completion submitted for review',
      message: `Completion was submitted for ${contract.job?.title ?? 'your contract'}.`,
      link: `/employer/contracts/${contract.id}`,
    }, transaction).catch(() => undefined);
    return mapContract(await transaction.contract.findUnique({ where: { id: contractId }, select: contractSelect }));
  });
};

export const confirmContractCompletion = async ({ contractId, employerId }) => {
  return prisma.$transaction(async (transaction) => {
    const contract = await lockProgressContract(transaction, contractId);
    if (!contract || contract.employerId !== employerId) throw new ContractNotFoundError();
    if (contract.freelanceDetails?.escrow?.status === 'RELEASE_ELIGIBLE') return mapContract(contract);
    assertFundedContract(contract);
    if (!contract.freelanceDetails.completionSubmittedAt) {
      throw new ContractProgressError('The seeker must submit completion before employer confirmation');
    }

    const confirmedAt = new Date();
    await transaction.freelanceContract.update({
      where: { contractId },
      data: { employerCompletionConfirmedAt: confirmedAt, workStatus: 'RELEASE_ELIGIBLE' },
    });
    await transaction.escrow.update({
      where: { freelanceContractId: contractId },
      data: { status: 'RELEASE_ELIGIBLE', releaseEligibleAt: confirmedAt },
    });
    await createNotification({
      recipientUserId: contract.seekerId,
      actorUserId: employerId,
      type: 'SUCCESS',
      category: 'PAYMENT',
      eventKey: `escrow:release-eligible:${contract.id}`,
      title: 'Payment is ready for release',
      message: `Payment for ${contract.job?.title ?? 'your contract'} is ready for final release.`,
      link: `/seeker/contracts/${contract.id}`,
    }, transaction).catch(() => undefined);
    return mapContract(await transaction.contract.findUnique({ where: { id: contractId }, select: contractSelect }));
  });
};
