import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

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
  releasedAmount: true,
  releasedAt: true,
};

const decimalToString = (value) => value.toFixed(2);

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
          releaseEligibleAt: true,
          releasedAmount: true,
          releasedAt: true,
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
    escrow: {
      ...contract.freelanceDetails.escrow,
      grossAmount: decimalToString(contract.freelanceDetails.escrow.grossAmount),
      platformFeeAmount: decimalToString(contract.freelanceDetails.escrow.platformFeeAmount),
      seekerNetAmount: decimalToString(contract.freelanceDetails.escrow.seekerNetAmount),
      releasedAmount: decimalToString(contract.freelanceDetails.escrow.releasedAmount),
    },
  },
});

export const listReleaseEligibleContracts = async () => {
  const contracts = await prisma.contract.findMany({
    where: {
      type: 'FREELANCE_PROJECT',
      freelanceDetails: { escrow: { status: 'RELEASE_ELIGIBLE' } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: releaseCandidateSelect,
  });

  return { contracts: contracts.map(mapReleaseCandidate) };
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

export const releaseContractFunds = async (contractId) => {
  return prisma.$transaction(async (transaction) => {
    const escrow = await lockEscrow(transaction, contractId);
    if (!escrow) throw new AdminReleaseNotFoundError();

    const contract = escrow.freelanceContract.contract;
    if (escrow.status === 'RELEASED') {
      return { alreadyReleased: true, escrow: releaseResult(escrow) };
    }

    if (contract.type !== 'FREELANCE_PROJECT') {
      throw new AdminReleaseConflictError('Only freelance contracts can be released');
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
    const wallet = lockedWallets[0];
    if (!wallet) throw new AdminReleaseConflictError('The seeker wallet does not exist');
    if (wallet.currency !== escrow.currency) {
      throw new AdminReleaseConflictError('The escrow currency does not match the seeker wallet');
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