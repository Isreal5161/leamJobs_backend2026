import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const withdrawalSelect = {
  id: true,
  seekerId: true,
  amount: true,
  currency: true,
  status: true,
  requestedAt: true,
  createdAt: true,
  payoutAccount: {
    select: {
      id: true,
      provider: true,
      bankCode: true,
      accountName: true,
      accountNumberLast4: true,
      verifiedAt: true,
      isDefault: true,
    },
  },
};

export class WithdrawalValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WithdrawalValidationError';
    this.status = 422;
  }
}

export class WithdrawalNotFoundError extends Error {
  constructor() {
    super('Payout account not found');
    this.name = 'WithdrawalNotFoundError';
    this.status = 404;
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super('Wallet not found');
    this.name = 'WalletNotFoundError';
    this.status = 404;
  }
}

export class WithdrawalConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WithdrawalConflictError';
    this.status = 409;
  }
}

const decimalToString = (value) => value.toFixed(2);
const toDecimal = (value) => new Prisma.Decimal(value);

const serializeWithdrawal = (withdrawal) => ({
  id: withdrawal.id,
  amount: decimalToString(withdrawal.amount),
  currency: withdrawal.currency,
  status: withdrawal.status,
  requestedAt: withdrawal.requestedAt,
  createdAt: withdrawal.createdAt,
  payoutAccount: withdrawal.payoutAccount ? {
    id: withdrawal.payoutAccount.id,
    provider: withdrawal.payoutAccount.provider,
    bankCode: withdrawal.payoutAccount.bankCode,
    accountName: withdrawal.payoutAccount.accountName,
    accountNumberLast4: withdrawal.payoutAccount.accountNumberLast4,
    verifiedAt: withdrawal.payoutAccount.verifiedAt,
    isDefault: withdrawal.payoutAccount.isDefault,
  } : null,
});

const assertSameIdempotentRequest = (existing, seekerId, amount, currency, payoutAccountId) => {
  if (
    existing.seekerId !== seekerId
    || !toDecimal(existing.amount).equals(amount)
    || existing.currency !== currency
    || existing.payoutAccountId !== payoutAccountId
  ) {
    throw new WithdrawalConflictError('Idempotency key was already used with different withdrawal details');
  }
};

const findExistingByIdempotencyKey = async (transaction, seekerId, amount, currency, payoutAccountId, idempotencyKey) => {
  const existing = await transaction.withdrawal.findUnique({
    where: { idempotencyKey },
    select: { ...withdrawalSelect, payoutAccountId: true },
  });

  if (!existing) return null;
  assertSameIdempotentRequest(existing, seekerId, amount, currency, payoutAccountId);
  return serializeWithdrawal(existing);
};

export const createSeekerWithdrawal = async (seekerId, payload) => {
  const amount = toDecimal(payload.amount);
  const currency = payload.currency.toUpperCase();

  if (amount.lte(0)) throw new WithdrawalValidationError('Withdrawal amount must be greater than zero');
  if (amount.gte(new Prisma.Decimal('1000000000000'))) throw new WithdrawalValidationError('Withdrawal amount is too large');

  try {
    return await prisma.$transaction(async (transaction) => {
      const lockedWallets = await transaction.$queryRaw`
        SELECT "id", "currency", "availableBalance", "pendingWithdrawalBalance", "version"
        FROM "Wallet"
        WHERE "userId" = ${seekerId}
        FOR UPDATE
      `;
      const wallet = lockedWallets[0];

      if (!wallet) throw new WalletNotFoundError();

      const existing = await findExistingByIdempotencyKey(transaction, seekerId, amount, currency, payload.payoutAccountId);
      if (existing) return existing;

      if (wallet.currency !== currency) throw new WithdrawalValidationError('Withdrawal currency does not match wallet currency');
      if (amount.gt(wallet.availableBalance)) throw new WithdrawalValidationError('Insufficient available balance');

      const payoutAccount = await transaction.payoutAccount.findFirst({
        where: {
          id: payload.payoutAccountId,
          userId: seekerId,
          disabledAt: null,
          verifiedAt: { not: null },
        },
        select: {
          id: true,
          provider: true,
          bankCode: true,
          accountName: true,
          accountNumberLast4: true,
          verifiedAt: true,
          isDefault: true,
        },
      });

      if (!payoutAccount) throw new WithdrawalNotFoundError();

      const resultingAvailableBalance = new Prisma.Decimal(wallet.availableBalance).minus(amount);
      const resultingPendingBalance = new Prisma.Decimal(wallet.pendingWithdrawalBalance).plus(amount);
      const updatedWallet = await transaction.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: resultingAvailableBalance,
          pendingWithdrawalBalance: resultingPendingBalance,
          version: { increment: 1 },
        },
        select: { availableBalance: true },
      });

      const withdrawal = await transaction.withdrawal.create({
        data: {
          walletId: wallet.id,
          seekerId,
          payoutAccountId: payoutAccount.id,
          amount,
          currency,
          status: 'PENDING',
          idempotencyKey: payload.idempotencyKey,
        },
        select: withdrawalSelect,
      });

      await transaction.financialLedgerEntry.create({
        data: {
          entryType: 'WITHDRAWAL_RESERVED',
          amount,
          currency,
          balanceAfter: updatedWallet.availableBalance,
          idempotencyKey: `${payload.idempotencyKey}:reservation`,
          description: 'Withdrawal funds reserved',
          walletId: wallet.id,
          withdrawalId: withdrawal.id,
        },
      });

      return serializeWithdrawal(withdrawal);
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await prisma.withdrawal.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
        select: { ...withdrawalSelect, payoutAccountId: true },
      });
      if (existing) {
        assertSameIdempotentRequest(existing, seekerId, amount, currency, payload.payoutAccountId);
        return serializeWithdrawal(existing);
      }
    }
    throw error;
  }
};
