import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { getActiveWithdrawalFeeConfiguration } from './platformFee.service.js';
import { executeWithdrawal } from './withdrawalExecution.service.js';
import { isSupportedPayoutAccount } from '../config/payoutCountries.js';

const WITHDRAWAL_QUOTE_TTL_SECONDS = 300;
const WITHDRAWAL_QUOTE_AUDIENCE = 'leamjobs-withdrawal-quote';

const withdrawalSelect = {
  id: true,
  seekerId: true,
  amount: true,
  withdrawalFeePercentage: true,
  withdrawalFeeAmount: true,
  payoutAmount: true,
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

export class WithdrawalQuoteError extends Error {
  constructor(message, { stale = false, status = 400 } = {}) {
    super(message);
    this.name = 'WithdrawalQuoteError';
    this.status = stale ? 409 : status;
    this.publicCode = stale ? 'WITHDRAWAL_QUOTE_STALE' : 'WITHDRAWAL_QUOTE_INVALID';
    this.publicMessage = message;
  }
}

const decimalToString = (value) => value.toFixed(2);
const toDecimal = (value) => new Prisma.Decimal(value);

const validateWithdrawalAmount = (amountValue) => {
  let amount;
  try {
    amount = toDecimal(amountValue);
  } catch {
    throw new WithdrawalValidationError('Withdrawal amount must be a valid decimal amount');
  }
  if (!amount.isFinite() || amount.lte(0)) throw new WithdrawalValidationError('Withdrawal amount must be greater than zero');
  if (amount.gte(new Prisma.Decimal('1000000000000'))) throw new WithdrawalValidationError('Withdrawal amount is too large');
  return amount;
};

const calculateWithdrawalAmounts = (amount, percentage) => {
  const fee = amount.mul(percentage).dividedBy(100).toDecimalPlaces(2);
  return { fee, payout: amount.minus(fee).toDecimalPlaces(2) };
};

const assertValidQuoteClaims = (claims, seekerId) => {
  if (!claims || typeof claims !== 'object'
    || claims.purpose !== 'seeker-withdrawal'
    || typeof claims.sub !== 'string'
    || typeof claims.amount !== 'string'
    || typeof claims.currency !== 'string'
    || typeof claims.payoutAccountId !== 'string'
    || typeof claims.payoutAccountVersion !== 'string'
    || typeof claims.withdrawalFeePercentage !== 'string'
    || typeof claims.withdrawalFeeAmount !== 'string'
    || typeof claims.payoutAmount !== 'string'
    || typeof claims.configurationVersion !== 'string'
    || !Number.isInteger(claims.exp)) {
    throw new WithdrawalQuoteError('The withdrawal quote is invalid. Request a new quote.');
  }
  if (claims.sub !== seekerId) {
    throw new WithdrawalQuoteError('The withdrawal quote is not available to this account.', { status: 403 });
  }
  return claims;
};

const verifyWithdrawalQuote = (reference, seekerId) => {
  let claims;
  try {
    claims = jwt.verify(reference, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: WITHDRAWAL_QUOTE_AUDIENCE,
      ignoreExpiration: true,
    });
  } catch {
    throw new WithdrawalQuoteError('The withdrawal quote is invalid. Request a new quote.');
  }
  return assertValidQuoteClaims(claims, seekerId);
};

export const getSeekerWithdrawalQuote = async (seekerId, { amount: amountValue, currency, payoutAccountId }) => {
  const amount = validateWithdrawalAmount(amountValue);
  const payoutAccount = await prisma.payoutAccount.findFirst({
    where: {
      id: payoutAccountId,
      userId: seekerId,
      provider: 'FLUTTERWAVE',
      payoutMethod: 'BANK_ACCOUNT',
      disabledAt: null,
      country: 'Nigeria',
      currency: 'NGN',
      verifiedAt: { not: null },
    },
    select: { id: true, provider: true, payoutMethod: true, country: true, currency: true, verifiedAt: true, updatedAt: true },
  });
  if (!payoutAccount) throw new WithdrawalNotFoundError();
  if (!isSupportedPayoutAccount(payoutAccount)) throw new WithdrawalNotFoundError();
  if (currency !== payoutAccount.currency) throw new WithdrawalValidationError('Withdrawal currency does not match the payout account');

  const { percentage: withdrawalFeePercentage, version: configurationVersion } = await getActiveWithdrawalFeeConfiguration(prisma);
  const { fee, payout } = calculateWithdrawalAmounts(amount, withdrawalFeePercentage);
  if (payout.lte(0)) throw new WithdrawalValidationError('Withdrawal amount must exceed the withdrawal charge');
  const quoteReference = jwt.sign({
    purpose: 'seeker-withdrawal',
    sub: seekerId,
    amount: decimalToString(amount),
    currency,
    payoutAccountId: payoutAccount.id,
    payoutAccountVersion: payoutAccount.updatedAt.toISOString(),
    withdrawalFeePercentage: decimalToString(withdrawalFeePercentage),
    withdrawalFeeAmount: decimalToString(fee),
    payoutAmount: decimalToString(payout),
    configurationVersion,
  }, env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: WITHDRAWAL_QUOTE_AUDIENCE,
    expiresIn: WITHDRAWAL_QUOTE_TTL_SECONDS,
  });
  const claims = jwt.decode(quoteReference);

  return {
    amount: decimalToString(amount),
    withdrawalFeePercentage: decimalToString(withdrawalFeePercentage),
    withdrawalFeeAmount: decimalToString(fee),
    payoutAmount: decimalToString(payout),
    currency,
    quoteReference,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
};

const serializeWithdrawal = (withdrawal) => ({
  id: withdrawal.id,
  amount: decimalToString(withdrawal.amount),
  withdrawalFeePercentage: decimalToString(withdrawal.withdrawalFeePercentage),
  withdrawalFeeAmount: decimalToString(withdrawal.withdrawalFeeAmount),
  payoutAmount: decimalToString(withdrawal.payoutAmount),
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
  const quote = verifyWithdrawalQuote(payload.quoteReference, seekerId);
  const amount = validateWithdrawalAmount(quote.amount);
  const currency = quote.currency;
  const payoutAccountId = quote.payoutAccountId;
  const withdrawalFeePercentage = toDecimal(quote.withdrawalFeePercentage);
  const withdrawalFeeAmount = toDecimal(quote.withdrawalFeeAmount);
  const payoutAmount = toDecimal(quote.payoutAmount);
  const expectedAmounts = calculateWithdrawalAmounts(amount, withdrawalFeePercentage);
  if (!/^[A-Z]{3}$/.test(currency)
    || !expectedAmounts.fee.eq(withdrawalFeeAmount)
    || !expectedAmounts.payout.eq(payoutAmount)
    || payoutAmount.lte(0)) {
    throw new WithdrawalQuoteError('The withdrawal quote is invalid. Request a new quote.');
  }

  try {
    const withdrawal = await prisma.$transaction(async (transaction) => {
      const lockedWallets = await transaction.$queryRaw`
        SELECT "id", "currency", "availableBalance", "pendingWithdrawalBalance", "version"
        FROM "Wallet"
        WHERE "userId" = ${seekerId}
        FOR UPDATE
      `;
      const wallet = lockedWallets[0];

      if (!wallet) throw new WalletNotFoundError();

      const existing = await findExistingByIdempotencyKey(transaction, seekerId, amount, currency, payoutAccountId, payload.idempotencyKey);
      if (existing) return existing;

      if (quote.exp * 1000 <= Date.now()) {
        throw new WithdrawalQuoteError('The withdrawal quote expired. A new quote is ready for review.', { stale: true });
      }
      if (wallet.currency !== currency) throw new WithdrawalValidationError('Withdrawal currency does not match wallet currency');
      if (amount.gt(wallet.availableBalance)) throw new WithdrawalValidationError('Insufficient available balance');

      await transaction.$queryRaw`
        SELECT "key"
        FROM "PlatformFeeConfiguration"
        WHERE "key" = 'default'
        FOR SHARE
      `;
      const activeConfiguration = await getActiveWithdrawalFeeConfiguration(transaction);
      if (activeConfiguration.version !== quote.configurationVersion
        || !activeConfiguration.percentage.eq(withdrawalFeePercentage)) {
        throw new WithdrawalQuoteError('The withdrawal charge changed. Review the refreshed quote before confirming.', { stale: true });
      }

      const payoutAccount = await transaction.payoutAccount.findFirst({
        where: {
          id: payoutAccountId,
          userId: seekerId,
          disabledAt: null,
          provider: 'FLUTTERWAVE',
          payoutMethod: 'BANK_ACCOUNT',
          country: 'Nigeria',
          currency: 'NGN',
          verifiedAt: { not: null },
        },
        select: {
          id: true,
          provider: true,
          payoutMethod: true,
          country: true,
          currency: true,
          bankCode: true,
          accountName: true,
          accountNumberLast4: true,
          verifiedAt: true,
          isDefault: true,
          updatedAt: true,
        },
      });

      if (!payoutAccount || !isSupportedPayoutAccount(payoutAccount) || payoutAccount.currency !== currency) throw new WithdrawalNotFoundError();
      if (payoutAccount.updatedAt.toISOString() !== quote.payoutAccountVersion) {
        throw new WithdrawalQuoteError('The payout account changed. Review the updated payout details before confirming.', { stale: true });
      }

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
          withdrawalFeePercentage,
          withdrawalFeeAmount,
          payoutAmount,
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
    if (process.env.NODE_ENV !== 'test') setImmediate(() => { void executeWithdrawal(withdrawal.id).catch(() => undefined); });
    return withdrawal;
  } catch (error) {
    if (error?.code === 'P2002') {
      const existing = await prisma.withdrawal.findUnique({
        where: { idempotencyKey: payload.idempotencyKey },
        select: { ...withdrawalSelect, payoutAccountId: true },
      });
      if (existing) {
        assertSameIdempotentRequest(existing, seekerId, amount, currency, payoutAccountId);
        return serializeWithdrawal(existing);
      }
    }
    throw error;
  }
};
