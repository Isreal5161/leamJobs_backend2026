import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const unresolvedStatuses = ['OPEN', 'UNDER_REVIEW'];
const resolutionStatuses = ['RESOLVED_FOR_EMPLOYER', 'RESOLVED_FOR_SEEKER', 'PARTIALLY_RESOLVED'];
const submissionEscrowStatuses = ['FUNDED', 'RELEASE_ELIGIBLE'];

export class ContractDisputeNotFoundError extends Error {
  constructor() {
    super('Eligible contract dispute not found');
    this.name = 'ContractDisputeNotFoundError';
    this.status = 404;
  }
}

export class ContractDisputeConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractDisputeConflictError';
    this.status = 409;
  }
}

const lockDisputeEscrow = async (transaction, contractId) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Escrow"
    WHERE "freelanceContractId" = ${contractId}
    FOR UPDATE
  `;

  return transaction.escrow.findUnique({
    where: { freelanceContractId: contractId },
    select: {
      id: true,
      freelanceContractId: true,
      status: true,
      fundedAmount: true,
      freelanceContract: {
        select: {
          contractId: true,
          contract: {
            select: {
              id: true,
              type: true,
              status: true,
              employerId: true,
              seekerId: true,
            },
          },
        },
      },
    },
  });
};

const disputeResult = (dispute, escrowStatus) => ({
  id: dispute.id,
  contractId: dispute.contractId,
  escrowId: dispute.escrowId,
  openedByUserId: dispute.openedByUserId,
  status: dispute.status,
  reason: dispute.reason,
  resolutionNote: dispute.resolutionNote,
  resolvedById: dispute.resolvedById,
  openedAt: dispute.openedAt,
  resolvedAt: dispute.resolvedAt,
  escrowStatus,
});

const amount = (value) => value?.toFixed(2) ?? null;

const adminDisputeSelect = {
  id: true,
  contractId: true,
  escrowId: true,
  openedByUserId: true,
  status: true,
  reason: true,
  resolutionNote: true,
  resolvedById: true,
  openedAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  openedBy: { select: { id: true, firstName: true, lastName: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
  contract: {
    select: {
      id: true,
      type: true,
      status: true,
      startDate: true,
      expectedEndDate: true,
      createdAt: true,
      job: { select: { id: true, title: true } },
      employer: { select: { id: true, firstName: true, lastName: true } },
      seeker: { select: { id: true, firstName: true, lastName: true } },
      freelanceDetails: {
        select: {
          agreedAmount: true,
          currency: true,
          platformFeeAmount: true,
          seekerNetAmount: true,
          workStatus: true,
        },
      },
    },
  },
  escrow: {
    select: {
      id: true,
      status: true,
      grossAmount: true,
      platformFeeAmount: true,
      seekerNetAmount: true,
      fundedAmount: true,
      releasedAmount: true,
      refundedAmount: true,
      currency: true,
      fundedAt: true,
      releaseEligibleAt: true,
      releasedAt: true,
      payments: {
        where: { paymentType: 'CONTRACT_FUNDING' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          paymentType: true,
          provider: true,
          verifiedAt: true,
          createdAt: true,
        },
      },
      ledgerEntries: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          entryType: true,
          amount: true,
          currency: true,
          createdAt: true,
        },
      },
    },
  },
};

const mapAdminDispute = (dispute) => ({
  id: dispute.id,
  status: dispute.status,
  reason: dispute.reason,
  resolutionNote: dispute.resolutionNote,
  openedAt: dispute.openedAt,
  resolvedAt: dispute.resolvedAt,
  createdAt: dispute.createdAt,
  updatedAt: dispute.updatedAt,
  openedBy: dispute.openedBy,
  resolvedBy: dispute.resolvedBy,
  contract: {
    id: dispute.contract.id,
    type: dispute.contract.type,
    status: dispute.contract.status,
    startDate: dispute.contract.startDate,
    expectedEndDate: dispute.contract.expectedEndDate,
    createdAt: dispute.contract.createdAt,
    job: dispute.contract.job,
    employer: dispute.contract.employer,
    candidate: dispute.contract.seeker,
    freelance: {
      agreedAmount: amount(dispute.contract.freelanceDetails?.agreedAmount),
      currency: dispute.contract.freelanceDetails?.currency ?? null,
      platformFeeAmount: amount(dispute.contract.freelanceDetails?.platformFeeAmount),
      seekerNetAmount: amount(dispute.contract.freelanceDetails?.seekerNetAmount),
      workStatus: dispute.contract.freelanceDetails?.workStatus ?? null,
    },
  },
  escrow: {
    id: dispute.escrow.id,
    status: dispute.escrow.status,
    grossAmount: amount(dispute.escrow.grossAmount),
    platformFeeAmount: amount(dispute.escrow.platformFeeAmount),
    seekerNetAmount: amount(dispute.escrow.seekerNetAmount),
    fundedAmount: amount(dispute.escrow.fundedAmount),
    releasedAmount: amount(dispute.escrow.releasedAmount),
    refundedAmount: amount(dispute.escrow.refundedAmount),
    currency: dispute.escrow.currency,
    fundedAt: dispute.escrow.fundedAt,
    releaseEligibleAt: dispute.escrow.releaseEligibleAt,
    releasedAt: dispute.escrow.releasedAt,
    payments: dispute.escrow.payments.map((payment) => ({
      id: payment.id,
      amount: amount(payment.amount),
      currency: payment.currency,
      status: payment.status,
      paymentType: payment.paymentType,
      provider: payment.provider,
      verifiedAt: payment.verifiedAt,
      createdAt: payment.createdAt,
    })),
    ledgerEntries: dispute.escrow.ledgerEntries.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      amount: amount(entry.amount),
      currency: entry.currency,
      createdAt: entry.createdAt,
    })),
  },
});

export const listAdminContractDisputes = async ({ page = 1, limit = 20 }) => {
  const where = { contract: { is: { type: 'FREELANCE_PROJECT' } } };
  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: adminDisputeSelect,
    }),
    prisma.dispute.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    disputes: disputes.map(mapAdminDispute),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

export const getAdminContractDispute = async (disputeId) => {
  const dispute = await prisma.dispute.findFirst({
    where: { id: disputeId, contract: { is: { type: 'FREELANCE_PROJECT' } } },
    select: adminDisputeSelect,
  });
  if (!dispute) throw new ContractDisputeNotFoundError();
  return mapAdminDispute(dispute);
};

export const submitContractDispute = async ({ contractId, userId, role, reason }) => prisma.$transaction(async (transaction) => {
  if (!['EMPLOYER', 'SEEKER'].includes(role)) throw new ContractDisputeNotFoundError();

  const escrow = await lockDisputeEscrow(transaction, contractId);
  const contract = escrow?.freelanceContract?.contract;
  if (!escrow || escrow.freelanceContract.contractId !== contractId || contract?.id !== contractId) {
    throw new ContractDisputeNotFoundError();
  }
  const ownsContract = role === 'EMPLOYER'
    ? contract.employerId === userId
    : contract.seekerId === userId;
  if (!ownsContract || contract.type !== 'FREELANCE_PROJECT') throw new ContractDisputeNotFoundError();
  if (!['ACTIVE', 'IN_PROGRESS'].includes(contract.status)
    || !submissionEscrowStatuses.includes(escrow.status)
    || !new Prisma.Decimal(escrow.fundedAmount).gt(0)) {
    throw new ContractDisputeConflictError('A dispute can only be opened for a funded freelance project.');
  }

  const existing = await transaction.dispute.findFirst({
    where: { contractId, escrowId: escrow.id },
    select: { id: true, status: true },
  });
  if (existing) throw new ContractDisputeConflictError('A dispute has already been submitted for this project.');

  const dispute = await transaction.dispute.create({
    data: {
      contractId,
      escrowId: escrow.id,
      openedByUserId: userId,
      status: 'OPEN',
      reason,
    },
    select: {
      id: true,
      contractId: true,
      escrowId: true,
      openedByUserId: true,
      status: true,
      reason: true,
      resolutionNote: true,
      resolvedById: true,
      openedAt: true,
      resolvedAt: true,
    },
  });
  await transaction.escrow.update({
    where: { id: escrow.id },
    data: { status: 'DISPUTED' },
  });

  return disputeResult(dispute, 'DISPUTED');
});

export const resolveContractDispute = async ({ contractId, disputeId, adminId, status, resolutionNote }) => prisma.$transaction(async (transaction) => {
  const escrow = await lockDisputeEscrow(transaction, contractId);
  if (!escrow || escrow.freelanceContract.contractId !== contractId
    || escrow.freelanceContract.contract.id !== contractId
    || escrow.freelanceContract.contract.type !== 'FREELANCE_PROJECT') {
    throw new ContractDisputeNotFoundError();
  }

  const dispute = await transaction.dispute.findFirst({
    where: { id: disputeId, contractId, escrowId: escrow.id },
    select: {
      id: true,
      contractId: true,
      escrowId: true,
      openedByUserId: true,
      status: true,
      reason: true,
      resolutionNote: true,
      resolvedById: true,
      openedAt: true,
      resolvedAt: true,
    },
  });
  if (!dispute) throw new ContractDisputeNotFoundError();
  if (!unresolvedStatuses.includes(dispute.status)) {
    throw new ContractDisputeConflictError('This dispute has already been resolved.');
  }
  if (status === 'UNDER_REVIEW' && dispute.status !== 'OPEN') {
    throw new ContractDisputeConflictError('Only an open dispute can be moved into review.');
  }
  if (!resolutionStatuses.includes(status) && status !== 'UNDER_REVIEW') {
    throw new ContractDisputeConflictError('The requested dispute status is not supported.');
  }
  if (resolutionStatuses.includes(status) && !resolutionNote?.trim()) {
    throw new ContractDisputeConflictError('A resolution note is required to resolve a dispute.');
  }
  if (resolutionStatuses.includes(status) && escrow.status !== 'DISPUTED') {
    throw new ContractDisputeConflictError('The disputed escrow is not in a safe hold state.');
  }

  const isResolved = resolutionStatuses.includes(status);
  const updated = await transaction.dispute.update({
    where: { id: dispute.id },
    data: {
      status,
      resolutionNote: resolutionNote ?? null,
      ...(isResolved ? { resolvedById: adminId, resolvedAt: new Date() } : {}),
    },
    select: {
      id: true,
      contractId: true,
      escrowId: true,
      openedByUserId: true,
      status: true,
      reason: true,
      resolutionNote: true,
      resolvedById: true,
      openedAt: true,
      resolvedAt: true,
    },
  });

  return {
    dispute: disputeResult(updated, escrow.status),
    fundsRemainHeld: true,
    message: 'Dispute status recorded. Funds remain held pending a separately authorized release or refund process.',
  };
});
