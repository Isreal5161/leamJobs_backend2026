import { prisma } from '../config/database.js';
import { decryptPayoutIdentifier, encryptPayoutIdentifier } from '../utils/payoutEncryption.js';
import { isNigeria } from '../config/payoutCountries.js';

export class PayoutAccountValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayoutAccountValidationError';
    this.status = 422;
  }
}

export class PayoutAccountNotFoundError extends Error {
  constructor() {
    super('Payout account not found');
    this.name = 'PayoutAccountNotFoundError';
    this.status = 404;
  }
}

export class PayoutAccountConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayoutAccountConflictError';
    this.status = 409;
  }
}

// Additive vs. the original shape: existing consumers (withdrawal dropdown) only read the
// fields that already existed, so adding columns here cannot break them.
const payoutAccountSelect = {
  id: true,
  provider: true,
  payoutMethod: true,
  country: true,
  currency: true,
  bankCode: true,
  bankName: true,
  accountName: true,
  accountNumberLast4: true,
  isDefault: true,
  verifiedAt: true,
  disabledAt: true,
  createdAt: true,
};

// Kept separate from `verifiedAt`/`disabledAt` (the real source of truth the withdrawal
// service already trusts) so this is purely a read-side convenience, never a stored flag.
const deriveStatus = (account) => {
  if (account.disabledAt) return 'DISABLED';
  if (account.verifiedAt) return 'ACTIVE';
  return 'PENDING_VERIFICATION';
};

const mapPayoutAccount = (account) => ({
  id: account.id,
  provider: account.provider,
  payoutMethod: account.payoutMethod,
  country: account.country,
  currency: account.currency,
  bankCode: account.bankCode,
  bankName: account.bankName,
  accountName: account.accountName,
  accountNumberLast4: account.accountNumberLast4,
  maskedAccountNumber: `****${account.accountNumberLast4}`,
  isDefault: account.isDefault,
  verifiedAt: account.verifiedAt,
  verified: Boolean(account.verifiedAt),
  status: deriveStatus(account),
});

export const getEligibleSeekerPayoutAccounts = async (seekerId) => {
  const accounts = await prisma.payoutAccount.findMany({
    where: {
      userId: seekerId,
      disabledAt: null,
      verifiedAt: { not: null },
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: payoutAccountSelect,
  });

  return accounts.map(mapPayoutAccount);
};

// Every non-disabled account the seeker owns, including ones still awaiting verification -
// used by a "manage payout accounts" view rather than the withdrawal account picker.
export const listAllSeekerPayoutAccounts = async (seekerId) => {
  const accounts = await prisma.payoutAccount.findMany({
    where: { userId: seekerId, disabledAt: null },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: payoutAccountSelect,
  });

  return accounts.map(mapPayoutAccount);
};

// Country is always the source of truth for method/currency/provider - never trust the client's copy.
const resolveMethodFields = (payload) => {
  if (isNigeria(payload.country)) {
    return {
      payoutMethod: 'BANK_ACCOUNT',
      provider: 'FLUTTERWAVE',
      currency: 'NGN',
      bankName: payload.bankName,
      bankCode: null,
      identifier: payload.accountNumber,
    };
  }

  return {
    payoutMethod: 'OTHER',
    provider: 'OTHER',
    currency: payload.currency,
    bankName: null,
    bankCode: null,
    identifier: payload.payoutIdentifier,
  };
};

const normalizeIdentifier = (value) => value.replace(/\s+/g, '').toUpperCase();

const isDuplicateOfExisting = (existingAccounts, country, payoutMethod, normalizedIdentifier) => existingAccounts.some((existing) => {
  if (existing.country !== country || existing.payoutMethod !== payoutMethod) return false;
  try {
    return normalizeIdentifier(decryptPayoutIdentifier(existing.encryptedAccountNumber)) === normalizedIdentifier;
  } catch {
    return false;
  }
});

const mapKnownPrismaError = (error) => {
  if (error?.code === 'P2002') {
    return new PayoutAccountConflictError('Only one default payout account is allowed at a time.');
  }
  return error;
};

export const createSeekerPayoutAccount = async (seekerId, payload) => {
  const resolved = resolveMethodFields(payload);
  const normalizedIdentifier = normalizeIdentifier(resolved.identifier);
  const last4 = normalizedIdentifier.slice(-4);

  try {
    return await prisma.$transaction(async (transaction) => {
      const existingAccounts = await transaction.payoutAccount.findMany({
        where: { userId: seekerId, disabledAt: null },
        select: { id: true, country: true, payoutMethod: true, encryptedAccountNumber: true },
      });

      if (isDuplicateOfExisting(existingAccounts, payload.country, resolved.payoutMethod, normalizedIdentifier)) {
        throw new PayoutAccountConflictError('This payout account already exists on your profile.');
      }

      const shouldBeDefault = payload.isDefault === true || existingAccounts.length === 0;

      if (shouldBeDefault) {
        await transaction.payoutAccount.updateMany({
          where: { userId: seekerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await transaction.payoutAccount.create({
        data: {
          userId: seekerId,
          provider: resolved.provider,
          payoutMethod: resolved.payoutMethod,
          country: payload.country,
          currency: resolved.currency,
          bankCode: resolved.bankCode,
          bankName: resolved.bankName,
          encryptedAccountNumber: encryptPayoutIdentifier(normalizedIdentifier),
          accountNumberLast4: last4,
          accountName: payload.accountHolderName,
          isDefault: shouldBeDefault,
          verifiedAt: null,
        },
        select: payoutAccountSelect,
      });

      return mapPayoutAccount(created);
    });
  } catch (error) {
    throw mapKnownPrismaError(error);
  }
};

const isDefaultOnlyPayload = (payload) => Object.keys(payload).length === 1 && 'isDefault' in payload;

export const updateSeekerPayoutAccount = async (seekerId, accountId, payload) => {
  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.payoutAccount.findFirst({
        where: { id: accountId, userId: seekerId, disabledAt: null },
      });

      if (!existing) throw new PayoutAccountNotFoundError();

      if (isDefaultOnlyPayload(payload)) {
        if (payload.isDefault) {
          await transaction.payoutAccount.updateMany({
            where: { userId: seekerId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const updated = await transaction.payoutAccount.update({
          where: { id: accountId },
          data: { isDefault: payload.isDefault },
          select: payoutAccountSelect,
        });

        return mapPayoutAccount(updated);
      }

      const resolved = resolveMethodFields(payload);
      const normalizedIdentifier = normalizeIdentifier(resolved.identifier);
      const last4 = normalizedIdentifier.slice(-4);

      const otherAccounts = await transaction.payoutAccount.findMany({
        where: { userId: seekerId, disabledAt: null, id: { not: accountId } },
        select: { id: true, country: true, payoutMethod: true, encryptedAccountNumber: true },
      });

      if (isDuplicateOfExisting(otherAccounts, payload.country, resolved.payoutMethod, normalizedIdentifier)) {
        throw new PayoutAccountConflictError('This payout account already exists on your profile.');
      }

      const shouldBeDefault = payload.isDefault === true || existing.isDefault;

      if (shouldBeDefault && !existing.isDefault) {
        await transaction.payoutAccount.updateMany({
          where: { userId: seekerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await transaction.payoutAccount.update({
        where: { id: accountId },
        data: {
          provider: resolved.provider,
          payoutMethod: resolved.payoutMethod,
          country: payload.country,
          currency: resolved.currency,
          bankCode: resolved.bankCode,
          bankName: resolved.bankName,
          encryptedAccountNumber: encryptPayoutIdentifier(normalizedIdentifier),
          accountNumberLast4: last4,
          accountName: payload.accountHolderName,
          isDefault: shouldBeDefault,
          // Details changed since the last verification, if any - it no longer attests to these values.
          verifiedAt: null,
        },
        select: payoutAccountSelect,
      });

      return mapPayoutAccount(updated);
    });
  } catch (error) {
    throw mapKnownPrismaError(error);
  }
};
