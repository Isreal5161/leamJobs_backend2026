import { prisma } from '../config/database.js';
import { decryptPayoutIdentifier, encryptPayoutIdentifier } from '../utils/payoutEncryption.js';
import { getPayoutCapability, isSupportedPayoutAccount } from '../config/payoutCountries.js';
import { FlutterwaveRequestError, getFlutterwaveBanks, resolveFlutterwaveBankAccount } from './flutterwave.service.js';

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

const resolvePayoutDetails = async (payload) => {
  const capability = getPayoutCapability(payload.country);
  if (!capability) {
    throw new PayoutAccountValidationError('Withdrawals are not currently supported for this country.');
  }

  const banks = await getFlutterwaveBanks(capability.countryCode);
  const bank = banks.find((entry) => entry.code === payload.bankCode);
  if (!bank) throw new PayoutAccountValidationError('Select a valid Nigerian bank from the list.');
  let verification;
  try {
    verification = await resolveFlutterwaveBankAccount({
      accountNumber: payload.accountNumber,
      bankCode: bank.code,
    });
  } catch (error) {
    if (error instanceof FlutterwaveRequestError && error.status === 422) {
      throw new PayoutAccountValidationError('Flutterwave could not verify this bank account. Check the bank and account number.');
    }
    throw error;
  }
  return {
    payoutMethod: 'BANK_ACCOUNT',
    provider: 'FLUTTERWAVE',
    currency: capability.currency,
    bankName: bank.name,
    bankCode: bank.code,
    identifier: payload.accountNumber,
    accountName: verification.accountName,
    verifiedAt: new Date(),
  };
};

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

const isWithdrawalSupported = (account) => isSupportedPayoutAccount(account) && !account.disabledAt;

const deriveStatus = (account) => {
  if (account.disabledAt) return 'DISABLED';
  const capability = getPayoutCapability(account.country);
  if (!capability || account.provider !== capability.provider
    || account.payoutMethod !== capability.payoutMethod || account.currency !== capability.currency) {
    return 'UNSUPPORTED';
  }
  if (capability.verifiedBeforeWithdrawal && !account.verifiedAt) return 'PENDING_VERIFICATION';
  if (isWithdrawalSupported(account)) return account.verifiedAt ? 'ACTIVE' : 'SUPPORTED_FOR_PAYOUT';
  return 'UNSUPPORTED';
};

const mapPayoutAccount = (account) => ({
  id: account.id,
  provider: account.provider,
  payoutMethod: account.payoutMethod,
  country: account.country,
  currency: account.currency,
  bankCode: null,
  bankName: account.bankName,
  accountName: account.accountName,
  accountNumberLast4: account.accountNumberLast4,
  maskedAccountNumber: `****${account.accountNumberLast4}`,
  isDefault: account.isDefault,
  verifiedAt: account.verifiedAt,
  verified: Boolean(account.verifiedAt && getPayoutCapability(account.country)?.verifiedBeforeWithdrawal && isWithdrawalSupported(account)),
  withdrawalSupported: isWithdrawalSupported(account),
  status: deriveStatus(account),
});

export const getEligibleSeekerPayoutAccounts = async (seekerId) => {
  const accounts = await prisma.payoutAccount.findMany({
    where: {
      userId: seekerId,
      provider: 'FLUTTERWAVE',
      payoutMethod: 'BANK_ACCOUNT',
      country: 'Nigeria',
      currency: 'NGN',
      verifiedAt: { not: null },
      disabledAt: null,
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
  const resolved = await resolvePayoutDetails(payload);
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
          encryptedPayoutMetadata: resolved.encryptedPayoutMetadata ?? null,
          accountNumberLast4: last4,
          accountName: resolved.accountName,
          isDefault: shouldBeDefault,
          verifiedAt: resolved.verifiedAt,
        },
        select: payoutAccountSelect,
      });

      return mapPayoutAccount(created);
    });
  } catch (error) {
    throw mapKnownPrismaError(error);
  }
};

export const updateSeekerPayoutAccount = async (seekerId, accountId, payload) => {
  const defaultOnly = Object.keys(payload).length === 1 && 'isDefault' in payload;
  let resolved = null;
  if (!defaultOnly) {
    const ownedAccount = await prisma.payoutAccount.findFirst({
      where: { id: accountId, userId: seekerId, disabledAt: null },
      select: { id: true },
    });
    if (!ownedAccount) throw new PayoutAccountNotFoundError();
    resolved = await resolvePayoutDetails(payload);
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.payoutAccount.findFirst({
        where: { id: accountId, userId: seekerId, disabledAt: null },
      });

      if (!existing) throw new PayoutAccountNotFoundError();

      if (defaultOnly) {
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

      const activeWithdrawal = await transaction.withdrawal.findFirst({
        where: { payoutAccountId: accountId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true },
      });
      if (activeWithdrawal) {
        throw new PayoutAccountConflictError('Payout details cannot be changed while a withdrawal is processing.');
      }

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
          encryptedPayoutMetadata: resolved.encryptedPayoutMetadata ?? null,
          accountNumberLast4: last4,
          accountName: resolved.accountName,
          isDefault: shouldBeDefault,
          verifiedAt: resolved.verifiedAt,
        },
        select: payoutAccountSelect,
      });

      return mapPayoutAccount(updated);
    });
  } catch (error) {
    throw mapKnownPrismaError(error);
  }
};
