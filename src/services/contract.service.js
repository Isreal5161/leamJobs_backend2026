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
  job: { select: { id: true, title: true, description: true, jobType: true, engagementType: true } },
  application: { select: { id: true, status: true, createdAt: true } },
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
              status: true,
              paymentType: true,
              provider: true,
              providerReference: true,
              verifiedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
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
    this.publicCode = 'FREELANCE_CONTRACT_CANCELLATION_BLOCKED';
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

const contractActions = (contract) => {
  const details = contract.freelanceDetails;
  const escrow = details?.escrow;
  const payments = escrow?.payments ?? [];
  const fundableStatus = contract.type === 'CONTRACT_PROJECT'
    ? contract.status === 'PENDING'
    : contract.type === 'FREELANCE_PROJECT' && ['PENDING', 'ACTIVE'].includes(contract.status);
  return {
    fund: Boolean(fundableStatus && escrow && ['UNFUNDED', 'FUNDING'].includes(escrow.status)),
    cancel: Boolean(
      contract.type === 'FREELANCE_PROJECT'
      && ['PENDING', 'ACTIVE'].includes(contract.status)
      && contract.application?.status === 'ACCEPTED'
      && details?.workStatus === 'PENDING'
      && escrow?.status === 'UNFUNDED'
      && new Prisma.Decimal(escrow.fundedAmount ?? 0).eq(0)
      && payments.length === 0,
    ),
    confirmCompletion: Boolean(
      contract.status === 'ACTIVE'
      && escrow?.status === 'FUNDED'
      && details?.completionSubmittedAt
      && !details?.employerCompletionConfirmedAt
      && (escrow.payments ?? []).some((payment) => payment.status === 'SUCCESSFUL'),
    ),
  };
};

export const mapContract = (contract) => ({
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
  availableActions: contractActions(contract),
});

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

export const getContractForParty = async ({ contractId, userId, role }) => {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: contractSelect });
  if (!contract) throw new ContractNotFoundError();
  const ownerId = role === 'EMPLOYER' ? contract.employerId : contract.seekerId;
  if (ownerId !== userId) throw new ContractNotFoundError();
  return mapContract(contract);
};

export const cancelEmployerFreelanceContract = async ({ contractId, employerId, applicationJobId }) => {
  const existing = await prisma.contract.findFirst({
    where: { id: contractId, employerId, ...(applicationJobId ? { jobId: applicationJobId } : {}) },
    select: { id: true, jobId: true },
  });
  if (!existing) throw new ContractNotFoundError();

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
      WHERE "id" = ${contractId} AND "employerId" = ${employerId}
      FOR UPDATE
    `;

    const contract = await transaction.contract.findFirst({
      where: { id: contractId, employerId, jobId: existing.jobId },
      select: {
        ...contractSelect,
        freelanceDetails: {
          select: {
            workStatus: true,
            agreedAmount: true,
            currency: true,
            escrow: {
              select: {
                id: true,
                status: true,
                fundedAmount: true,
                releasedAmount: true,
                refundedAmount: true,
                fundedAt: true,
                releasedAt: true,
                payments: {
                  where: { paymentType: 'CONTRACT_FUNDING' },
                  select: { status: true },
                },
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
    if (contract.type !== 'FREELANCE_PROJECT' || !contract.freelanceDetails?.escrow) {
      throw new FreelanceContractCancellationError('Only freelance contracts with an escrow can be cancelled through this action.', 409);
    }

    await transaction.$queryRaw`
      SELECT "id"
      FROM "Escrow"
      WHERE "id" = ${contract.freelanceDetails.escrow.id}
      FOR UPDATE
    `;
    const escrow = await transaction.escrow.findUnique({
      where: { id: contract.freelanceDetails.escrow.id },
      select: {
        id: true,
        status: true,
        fundedAmount: true,
        releasedAmount: true,
        refundedAmount: true,
        fundedAt: true,
        releasedAt: true,
        payments: {
          where: { paymentType: 'CONTRACT_FUNDING' },
          select: { status: true },
        },
        refunds: { select: { id: true } },
        disputes: { select: { id: true } },
        ledgerEntries: { select: { id: true } },
      },
    });
    if (!escrow) throw new FreelanceContractCancellationError('The contract escrow is unavailable.');

    if (escrow.payments.length > 0) {
      throw new FreelanceContractCancellationError(
        'This contract has a payment attempt on record. A provider may still report a late result, so resolve the payment state before cancelling.',
      );
    }

    const hasFinancialActivity = new Prisma.Decimal(escrow.fundedAmount).gt(0)
      || new Prisma.Decimal(escrow.releasedAmount).gt(0)
      || new Prisma.Decimal(escrow.refundedAmount).gt(0)
      || Boolean(escrow.fundedAt || escrow.releasedAt)
      || escrow.refunds.length > 0
      || escrow.disputes.length > 0
      || escrow.ledgerEntries.length > 0
      || escrow.payments.length > 0;
    if (hasFinancialActivity || escrow.status !== 'UNFUNDED') {
      throw new FreelanceContractCancellationError(
        'This contract has financial activity or is no longer unfunded. Use its existing payment and escrow workflow instead.',
      );
    }

    if (!['PENDING', 'ACTIVE'].includes(contract.status)
      || contract.freelanceDetails.workStatus !== 'PENDING'
      || contract.application?.status !== 'ACCEPTED') {
      throw new FreelanceContractCancellationError('This freelance contract is no longer eligible for cancellation.');
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
    await transaction.escrow.update({
      where: { id: escrow.id },
      data: { status: 'CANCELLED', cancelledAt },
    });
    await transaction.application.update({
      where: { id: contract.applicationId },
      data: { status: 'REJECTED' },
    });
    await createNotification({
      recipientUserId: contract.seekerId,
      actorUserId: employerId,
      type: 'WARNING',
      category: 'CONTRACT',
      eventKey: `contract:cancelled:${contract.id}`,
      title: 'Freelance contract cancelled before funding',
      message: `The employer cancelled the unfunded contract for ${contract.job?.title ?? 'the project'}.`,
      link: '/seeker/applications',
    }, transaction);
  });

  return getContractForParty({ contractId, userId: employerId, role: 'EMPLOYER' });
};

export const listEmployerContracts = async ({ employerId, page, limit, status }) => {
  const where = {
    employerId,
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
  return {
    contracts: contracts.map(mapContract),
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

    if (contract.status === 'ACTIVE') return mapContract(contract);
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
    if (alreadyConfirmed) return mapContract(contract);

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

    return mapContract({
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
