import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { decryptPayoutIdentifier } from '../utils/payoutEncryption.js';
import { isSupportedPayoutAccount } from '../config/payoutCountries.js';
import {
  createFlutterwaveTransfer,
  getFlutterwaveTransferById,
  isFlutterwaveConfigured,
  normalizeFlutterwaveTransferStatus,
} from './flutterwave.service.js';
import {
  createPaystackTransfer,
  createPaystackTransferRecipient,
  getPaystackTransferByReference,
  getPaystackTransferByCode,
  isPaystackConfigured,
  normalizePaystackTransferStatus,
} from './paystack.service.js';
import { assertFreelancePaymentFeatureEnabled, resolveFreelancePaymentFeatures } from '../config/freelancePaymentFeatures.js';
import { isFlutterwaveUsdWithdrawalAvailable } from '../config/flutterwaveUsdCapabilities.js';
import { isWithdrawalCurrencyEnabled } from '../config/walletCurrencies.js';
import { decryptWithdrawalTransferMetadataSnapshot } from './withdrawalTransferMetadata.js';
import { FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE } from '../config/payoutCountries.js';

const finalizedStatuses = new Set(['SUCCESSFUL', 'FAILED', 'CANCELLED']);
export const withdrawalReference = (withdrawalId) => `lj_wd_${withdrawalId}`;

const withdrawalDetails = {
  id: true,
  walletId: true,
  seekerId: true,
  payoutAccountId: true,
  amount: true,
  withdrawalFeeAmount: true,
  payoutAmount: true,
  currency: true,
  status: true,
  provider: true,
  providerReference: true,
  payoutMethodSnapshot: true,
  payoutCountrySnapshot: true,
  bankCodeSnapshot: true,
  bankNameSnapshot: true,
  accountNameSnapshot: true,
  encryptedAccountNumberSnapshot: true,
  encryptedTransferMetadataSnapshot: true,
  accountNumberLast4Snapshot: true,
  payoutAccountVerifiedAtSnapshot: true,
  processingAt: true,
  payoutAccount: { select: { userId: true, provider: true, payoutMethod: true, country: true, currency: true, bankCode: true, bankName: true, accountName: true, encryptedAccountNumber: true, encryptedPayoutMetadata: true, verifiedAt: true, disabledAt: true } },
  payout: { select: { id: true, amount: true, providerReference: true, status: true } },
};

const providerError = (message, status = 422) => Object.assign(new Error(message), { status });
const preSubmissionError = (message, status = 409) => Object.assign(providerError(message, status), { preSubmissionFailure: true });
const decryptDestinationValue = (encryptedValue, message) => {
  try {
    const value = decryptPayoutIdentifier(encryptedValue);
    if (!value.trim()) throw new Error('Empty payout value');
    return value;
  } catch {
    throw preSubmissionError(message);
  }
};

const getPayoutDestination = (withdrawal) => ({
  provider: withdrawal.provider ?? withdrawal.payoutAccount.provider,
  payoutMethod: withdrawal.payoutMethodSnapshot ?? withdrawal.payoutAccount.payoutMethod,
  country: withdrawal.payoutCountrySnapshot ?? withdrawal.payoutAccount.country,
  currency: withdrawal.currency,
  bankCode: withdrawal.payoutCountrySnapshot === 'United States'
    ? null
    : withdrawal.bankCodeSnapshot ?? withdrawal.payoutAccount.bankCode,
  bankName: withdrawal.bankNameSnapshot ?? withdrawal.payoutAccount.bankName,
  accountName: withdrawal.accountNameSnapshot ?? withdrawal.payoutAccount.accountName,
  encryptedAccountNumber: withdrawal.encryptedAccountNumberSnapshot ?? withdrawal.payoutAccount.encryptedAccountNumber,
  encryptedPayoutMetadata: withdrawal.encryptedTransferMetadataSnapshot ?? withdrawal.payoutAccount.encryptedPayoutMetadata,
  encryptedTransferMetadataSnapshot: withdrawal.encryptedTransferMetadataSnapshot,
  accountNumberLast4: withdrawal.accountNumberLast4Snapshot ?? withdrawal.payoutAccount.accountNumberLast4,
  verifiedAt: withdrawal.payoutAccountVerifiedAtSnapshot ?? withdrawal.payoutAccount.verifiedAt,
});

const createLegacyPaystackTransfer = async ({ withdrawal, accountNumber }) => {
  const recipient = await createPaystackTransferRecipient({
    name: withdrawal.payoutDestination.accountName,
    accountNumber,
    bankCode: withdrawal.payoutDestination.bankCode,
  });
  if (!recipient?.recipient_code) throw providerError('Paystack did not return a payout recipient', 502);
  return createPaystackTransfer({
    amount: withdrawal.payout.amount.toString(),
    recipientCode: recipient.recipient_code,
    reference: withdrawal.providerReference,
    reason: 'LeamJobs wallet withdrawal',
  });
};

const claimWithdrawal = async (withdrawalId) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId} FOR UPDATE`;
  const withdrawal = await transaction.withdrawal.findUnique({ where: { id: withdrawalId }, select: withdrawalDetails });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(withdrawal.status)) return { finalized: true, withdrawal };
  if (withdrawal.status === 'PROCESSING') return { processing: true, withdrawal };
  const payoutDestination = getPayoutDestination(withdrawal);
  const payoutProvider = payoutDestination.provider;
  if (!['FLUTTERWAVE', 'PAYSTACK'].includes(payoutProvider)) throw providerError('This payout account is not configured for bank withdrawals', 422);
  if (withdrawal.payoutAccount.userId !== withdrawal.seekerId) throw providerError('The payout account does not belong to the withdrawal owner', 403);
  if (withdrawal.payoutAccount.disabledAt) throw providerError('The payout account is disabled', 422);
  if (payoutProvider === 'PAYSTACK' && !payoutDestination.verifiedAt) {
    throw providerError('The legacy Paystack payout account is no longer verified', 422);
  }
  if (payoutProvider === 'FLUTTERWAVE' && !isSupportedPayoutAccount(payoutDestination)) {
    throw providerError('The Flutterwave payout account is not supported or validated', 422);
  }
  if (withdrawal.currency !== payoutDestination.currency) throw providerError('Withdrawal currency does not match the payout account', 422);
  if (payoutProvider === 'FLUTTERWAVE' && payoutDestination.country === 'Nigeria'
    && payoutDestination.currency === 'NGN' && !payoutDestination.verifiedAt) {
    throw providerError('The Nigerian payout account is no longer verified', 422);
  }
  if (payoutProvider === 'FLUTTERWAVE' && payoutDestination.currency === 'USD'
    && !payoutDestination.encryptedTransferMetadataSnapshot) {
    throw preSubmissionError('This USD withdrawal has no immutable transfer metadata snapshot and requires manual review.');
  }
  if (payoutProvider === 'FLUTTERWAVE' && payoutDestination.country === 'Nigeria'
    && payoutDestination.currency === 'USD' && !FLUTTERWAVE_NIGERIAN_DOM_USD_AVAILABLE) {
    throw providerError('Flutterwave currently reports Nigerian USD domiciliary IMTO transfers as unavailable. This route is disabled.', 503);
  }
  if (payoutDestination.country === 'Nigeria' && !/^\d{3,20}$/.test(String(payoutDestination.bankCode ?? ''))) {
    throw providerError('The payout account is missing a valid bank code', 422);
  }
  if (payoutDestination.country === 'United States' && payoutDestination.currency === 'USD'
    && !payoutDestination.encryptedTransferMetadataSnapshot) {
    throw preSubmissionError('The US payout account is missing its immutable bank routing metadata snapshot.');
  }

  const isUsdFlutterwave = payoutProvider === 'FLUTTERWAVE' && payoutDestination.currency === 'USD';
  if (isUsdFlutterwave && !withdrawal.encryptedAccountNumberSnapshot) {
    throw preSubmissionError('This USD withdrawal has no immutable account-number snapshot and requires manual review.');
  }
  const accountNumber = decryptDestinationValue(
    isUsdFlutterwave ? withdrawal.encryptedAccountNumberSnapshot : payoutDestination.encryptedAccountNumber,
    'The saved payout account could not be decrypted. The withdrawal remains reserved and pending review.',
  );
  let transferMetadata;
  if (isUsdFlutterwave) {
    try {
      transferMetadata = decryptWithdrawalTransferMetadataSnapshot(withdrawal.encryptedTransferMetadataSnapshot);
    } catch {
      throw preSubmissionError('The saved USD bank metadata could not be decrypted or is incomplete. The withdrawal remains reserved and pending review.');
    }
  }

  const reference = withdrawal.providerReference || withdrawalReference(withdrawal.id);
  const payout = withdrawal.payout ?? await transaction.payout.create({
    data: {
      withdrawalId: withdrawal.id,
      recipientUserId: withdrawal.seekerId,
      amount: withdrawal.payoutAmount,
      currency: withdrawal.currency,
      provider: payoutProvider,
      providerReference: reference,
      status: 'PROCESSING',
    },
    select: { id: true, amount: true, providerReference: true, status: true },
  });
  if (!new Prisma.Decimal(payout.amount).eq(withdrawal.payoutAmount)) {
    throw providerError('Payout amount does not match the saved withdrawal terms', 409);
  }
  const attemptCount = await transaction.payoutAttempt.count({ where: { payoutId: payout.id } });
  const attempt = await transaction.payoutAttempt.create({ data: { payoutId: payout.id, attemptNumber: attemptCount + 1, status: 'PROCESSING' }, select: { id: true } });
  const claimed = await transaction.withdrawal.updateMany({ where: { id: withdrawal.id, status: 'PENDING' }, data: { status: 'PROCESSING', provider: payoutProvider, providerReference: reference, processingAt: new Date() } });
  if (claimed.count !== 1) return { processing: true, withdrawal };
  await transaction.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', provider: payoutProvider, providerReference: reference } });
  return {
    withdrawal: {
      ...withdrawal,
      payoutDestination: { ...payoutDestination, accountNumber, transferMetadata },
      providerReference: reference,
      payout: { ...payout, id: payout.id },
    },
    attemptId: attempt.id,
    payoutId: payout.id,
  };
});

const updateAttempt = async (attemptId, data) => prisma.payoutAttempt.update({ where: { id: attemptId }, data }).catch(() => undefined);
const associateAttemptTransfer = async (attemptId, transferId, additionalData = {}) => {
  const transferReference = String(transferId);
  const association = await prisma.payoutAttempt.updateMany({
    where: {
      id: attemptId,
      OR: [{ providerReference: null }, { providerReference: transferReference }],
    },
    data: { ...additionalData, providerReference: transferReference },
  });
  if (association.count !== 1) {
    throw Object.assign(
      providerError('A different provider transfer is already associated with this withdrawal attempt', 409),
      { transferAssociationConflict: true },
    );
  }
};

const assertTransferMatchesWithdrawal = (withdrawal, providerTransfer, provider) => {
  const providerAmount = providerTransfer?.amount;
  const expectedAmount = provider === 'PAYSTACK'
    ? new Prisma.Decimal(withdrawal.payout.amount).mul(100)
    : new Prisma.Decimal(withdrawal.payout.amount);
  const providerCurrency = String(providerTransfer?.currency ?? '').toUpperCase();
  const amountMatches = provider === 'PAYSTACK'
    ? Number.isSafeInteger(Number(providerAmount)) && new Prisma.Decimal(providerAmount).eq(expectedAmount)
    : providerAmount !== undefined && providerAmount !== null && new Prisma.Decimal(providerAmount).eq(expectedAmount);
  const referenceMatches = String(providerTransfer?.reference ?? '') === withdrawal.providerReference;
  if (!amountMatches || providerCurrency !== String(withdrawal.currency).toUpperCase() || !referenceMatches) {
    throw providerError(`${provider} transfer reference, amount, or currency does not match the withdrawal`, 409);
  }
};

const applyOutcome = async ({ withdrawalId, status, providerTransfer, preSubmissionFailure = false }) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId} FOR UPDATE`;
  const withdrawal = await transaction.withdrawal.findUnique({ where: { id: withdrawalId }, select: { id: true, walletId: true, amount: true, withdrawalFeeAmount: true, currency: true, status: true, provider: true, providerReference: true, payout: { select: { id: true, amount: true } } } });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  const isReversal = status === 'REVERSED';
  if (finalizedStatuses.has(withdrawal.status) && !(isReversal && withdrawal.status === 'SUCCESSFUL')) return { alreadyFinalized: true, status: withdrawal.status };
  if (!withdrawal.payout) throw providerError('Withdrawal payout record is missing', 409);

  const provider = withdrawal.provider;
  const providerReference = provider === 'PAYSTACK' && providerTransfer?.transfer_code
    ? String(providerTransfer.transfer_code)
    : withdrawal.providerReference;
  const withdrawalFeeAmount = new Prisma.Decimal(withdrawal.withdrawalFeeAmount ?? 0);
  const attempt = await transaction.payoutAttempt.findFirst({
    where: { payoutId: withdrawal.payout.id, ...(isReversal ? {} : { status: { in: ['PROCESSING', 'PENDING'] } }) },
    orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, providerReference: true },
  });
  if (provider === 'FLUTTERWAVE' && !preSubmissionFailure) {
    const transferId = providerTransfer?.id === undefined || providerTransfer?.id === null
      ? ''
      : String(providerTransfer.id);
    if (!attempt?.providerReference || attempt.providerReference !== transferId) {
      throw providerError('Flutterwave transfer ID does not match the transfer associated with this withdrawal attempt', 409);
    }
  }
  if (provider === 'FLUTTERWAVE' && preSubmissionFailure && attempt?.providerReference) {
    throw providerError('A Flutterwave transfer is already associated with this attempt; the rejection cannot release its reservation', 409);
  }
  if (status === 'SUCCESSFUL' || status === 'FAILED' || isReversal) assertTransferMatchesWithdrawal(withdrawal, providerTransfer, provider);
  if (status === 'SUCCESSFUL') {
    const walletRows = await transaction.$queryRaw`SELECT "id", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} AND "currency" = ${withdrawal.currency} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount)) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { pendingWithdrawalBalance: { decrement: withdrawal.amount }, version: { increment: 1 } } });
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'SUCCESSFUL', completedAt: new Date(), failureReason: null } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'SUCCESSFUL', processedAt: new Date(), providerReference } });
    if (attempt) {
      const attemptData = { status: 'SUCCESSFUL', processedAt: new Date() };
      const attemptTransferReference = provider === 'FLUTTERWAVE'
        ? (providerTransfer?.id === undefined || providerTransfer?.id === null ? null : String(providerTransfer.id))
        : (providerTransfer?.id ? String(providerTransfer.id) : providerReference);
      if (attemptTransferReference !== null) attemptData.providerReference = attemptTransferReference;
      await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: attemptData });
    }
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_SUCCESSFUL', amount: withdrawal.payout.amount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:successful`, description: `Net withdrawal payout completed by ${provider}`, walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    if (withdrawalFeeAmount.gt(0)) {
      await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FEE', amount: withdrawalFeeAmount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:fee`, description: 'Platform withdrawal charge collected', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    }
    return { status: 'SUCCESSFUL' };
  }

  if (status === 'FAILED' || isReversal) {
    const walletRows = await transaction.$queryRaw`SELECT "id", "availableBalance", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} AND "currency" = ${withdrawal.currency} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || (!isReversal && new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount))) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { availableBalance: { increment: withdrawal.amount }, ...(isReversal ? {} : { pendingWithdrawalBalance: { decrement: withdrawal.amount } }), version: { increment: 1 } } });
    const failureReason = providerTransfer?.failure_reason || providerTransfer?.complete_message || `${provider} transfer failed`;
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason, providerReference } });
    if (attempt) {
      const attemptData = { status: 'FAILED', processedAt: new Date(), failureReason };
      const attemptTransferReference = provider === 'FLUTTERWAVE'
        ? (providerTransfer?.id === undefined || providerTransfer?.id === null ? null : String(providerTransfer.id))
        : (providerTransfer?.id ? String(providerTransfer.id) : providerReference);
      if (attemptTransferReference !== null) attemptData.providerReference = attemptTransferReference;
      await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: attemptData });
    }
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FAILED_REVERSAL', amount: withdrawal.amount, currency: withdrawal.currency, balanceAfter: new Prisma.Decimal(wallet.availableBalance).plus(withdrawal.amount), idempotencyKey: `${withdrawal.id}:failed-reversal`, description: isReversal ? `${provider} withdrawal reversed after payout success` : `Withdrawal reservation released after ${provider} failure`, walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    if (isReversal && withdrawalFeeAmount.gt(0)) {
      await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FEE_REVERSAL', amount: withdrawalFeeAmount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:fee-reversal`, description: 'Platform withdrawal charge reversed after payout reversal', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    }
    return { status: 'FAILED' };
  }

  return { status: 'PROCESSING' };
});

export const reconcileWithdrawal = async (withdrawalId) => {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, select: { id: true, status: true, provider: true, providerReference: true, payout: { select: { attempts: { orderBy: [{ attemptNumber: 'desc' }], take: 1, select: { providerReference: true, failureReason: true } } } } } });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(withdrawal.status) && withdrawal.status !== 'SUCCESSFUL') return { alreadyFinalized: true, status: withdrawal.status };
  if (!['PAYSTACK', 'FLUTTERWAVE'].includes(withdrawal.provider) || !withdrawal.providerReference) throw providerError('Withdrawal is not ready for provider reconciliation', 422);
  const transferCode = withdrawal.payout?.attempts?.[0]?.providerReference;
  if (withdrawal.provider === 'FLUTTERWAVE' && !transferCode) {
    return {
      status: 'PROCESSING',
      unresolved: true,
      manualReviewRequired: true,
      message: withdrawal.payout?.attempts?.[0]?.failureReason
        ?? 'Flutterwave did not return a transfer ID. Keep the reservation and reconcile manually; do not submit another payout.',
    };
  }
  const transfer = withdrawal.provider === 'FLUTTERWAVE'
    ? await getFlutterwaveTransferById(transferCode)
    : transferCode
      ? await getPaystackTransferByCode(transferCode)
      : await getPaystackTransferByReference(withdrawal.providerReference);
  if (!transfer) return { status: 'PROCESSING', unresolved: true };
  const status = withdrawal.provider === 'FLUTTERWAVE'
    ? normalizeFlutterwaveTransferStatus(transfer.status)
    : normalizePaystackTransferStatus(transfer.status);
  return applyOutcome({ withdrawalId, status, providerTransfer: transfer });
};

export const recoverFlutterwaveTransfer = async (withdrawalId, transferId, adminId) => {
  if (!/^\d+$/.test(String(transferId ?? ''))) throw providerError('A valid Flutterwave transfer ID is required', 400);
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      seekerId: true,
      status: true,
      provider: true,
      providerReference: true,
      currency: true,
      payout: {
        select: {
          id: true,
          amount: true,
          recipientUserId: true,
          attempts: {
            orderBy: [{ attemptNumber: 'desc' }],
            take: 1,
            select: { id: true, providerReference: true, status: true },
          },
        },
      },
    },
  });
  const attempt = withdrawal?.payout?.attempts?.[0];
  if (!withdrawal || withdrawal.status !== 'PROCESSING' || withdrawal.provider !== 'FLUTTERWAVE'
    || !withdrawal.providerReference || !withdrawal.payout || !attempt
    || attempt.status !== 'PROCESSING'
    || withdrawal.payout.recipientUserId !== withdrawal.seekerId) {
    throw providerError('This withdrawal is not eligible for Flutterwave transfer recovery', 409);
  }
  if (attempt.providerReference && attempt.providerReference !== String(transferId)) {
    throw providerError('A Flutterwave transfer is already associated with this withdrawal', 409);
  }

  const transfer = await getFlutterwaveTransferById(String(transferId));
  if (!transfer || String(transfer.id) !== String(transferId)) {
    throw providerError('Flutterwave did not verify the specified transfer', 404);
  }
  let amountMatches = false;
  try {
    amountMatches = transfer.amount !== undefined && transfer.amount !== null
      && new Prisma.Decimal(transfer.amount).eq(withdrawal.payout.amount);
  } catch {
    amountMatches = false;
  }
  if (String(transfer.reference ?? '') !== withdrawal.providerReference
    || !amountMatches
    || String(transfer.currency ?? '').toUpperCase() !== withdrawal.currency) {
    throw providerError('The verified Flutterwave transfer does not match the saved withdrawal reference, amount, and currency', 409);
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId} FOR UPDATE`;
    const current = await transaction.withdrawal.findUnique({
      where: { id: withdrawalId },
      select: {
        id: true,
        seekerId: true,
        status: true,
        provider: true,
        providerReference: true,
        currency: true,
        payout: { select: { id: true, amount: true, recipientUserId: true } },
      },
    });
    if (!current?.payout) throw providerError('Withdrawal recovery state changed; refresh and review before continuing', 409);
    const currentAttempt = await transaction.payoutAttempt.findFirst({
      where: { payoutId: current.payout.id },
      orderBy: [{ attemptNumber: 'desc' }],
      select: { id: true, providerReference: true, status: true },
    });
    if (!current || current.status !== 'PROCESSING' || current.provider !== 'FLUTTERWAVE'
      || current.providerReference !== withdrawal.providerReference
      || current.currency !== withdrawal.currency
      || current.seekerId !== current.payout?.recipientUserId
      || !current.payout
      || !currentAttempt
      || currentAttempt.id !== attempt.id
      || currentAttempt.status !== 'PROCESSING'
      || (currentAttempt.providerReference && currentAttempt.providerReference !== String(transfer.id))) {
      throw providerError('Withdrawal recovery state changed; refresh and review before continuing', 409);
    }
    if (!new Prisma.Decimal(current.payout.amount).eq(withdrawal.payout.amount)) {
      throw providerError('Withdrawal recovery amount changed; refresh and review before continuing', 409);
    }
    const updated = await transaction.payoutAttempt.updateMany({
      where: {
        id: currentAttempt.id,
        status: 'PROCESSING',
        OR: [{ providerReference: null }, { providerReference: String(transfer.id) }],
      },
      data: { providerReference: String(transfer.id) },
    });
    if (updated.count !== 1) throw providerError('A different Flutterwave transfer is already associated with this withdrawal', 409);
    await transaction.financialAuditLog.create({
      data: {
        actorUserId: adminId,
        entityType: 'WITHDRAWAL',
        entityId: current.id,
        action: 'VERIFIED',
        fromStatus: current.status,
        toStatus: current.status,
        amount: current.payout.amount,
        currency: current.currency,
        reason: 'Admin associated a provider-verified Flutterwave transfer for withdrawal recovery',
        metadata: {
          provider: 'FLUTTERWAVE',
          providerReference: current.providerReference,
          transferId: String(transfer.id),
          verification: 'Flutterwave transfer lookup',
        },
      },
    });
  });

  const status = normalizeFlutterwaveTransferStatus(transfer.status);
  if (status === 'PROCESSING') return { status: 'PROCESSING', unresolved: true, transferAssociated: true };
  return applyOutcome({ withdrawalId, status, providerTransfer: transfer });
};

export const executeWithdrawal = async (withdrawalId) => {
  const existingWithdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    select: { status: true, provider: true, currency: true, payoutAccount: { select: { provider: true } } },
  });
  if (!existingWithdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(existingWithdrawal.status) || existingWithdrawal.status === 'PROCESSING') {
    return { status: existingWithdrawal.status, alreadyHandled: true };
  }
  assertFreelancePaymentFeatureEnabled('withdrawalsEnabled');
  if (existingWithdrawal.currency === 'USD' && !isFlutterwaveUsdWithdrawalAvailable()) {
    throw providerError('USD withdrawals are unavailable until an approved beneficiary verification and settlement route are implemented', 503);
  }
  if (existingWithdrawal.currency === 'USD' && !resolveFreelancePaymentFeatures().usdWithdrawalsEnabled) {
    throw providerError('USD withdrawals are currently disabled', 503);
  }
  const payoutProvider = existingWithdrawal.provider ?? existingWithdrawal.payoutAccount?.provider;
  if (payoutProvider === 'FLUTTERWAVE' && !isFlutterwaveConfigured()) throw providerError('Flutterwave payout configuration is unavailable', 503);
  if (payoutProvider === 'PAYSTACK' && !isPaystackConfigured()) throw providerError('Paystack payout configuration is unavailable', 503);
  if (!['FLUTTERWAVE', 'PAYSTACK'].includes(payoutProvider)) throw providerError('This payout account is not configured for bank withdrawals', 422);
  const claim = await claimWithdrawal(withdrawalId);
  if (claim.finalized || claim.processing) return { status: claim.withdrawal.status, alreadyHandled: true };
  try {
    const { accountNumber, transferMetadata: meta } = claim.withdrawal.payoutDestination;
    const transfer = payoutProvider === 'FLUTTERWAVE'
      ? await createFlutterwaveTransfer({
        amount: claim.withdrawal.payout.amount.toString(),
        accountNumber,
        bankCode: claim.withdrawal.payoutDestination.bankCode,
        beneficiaryName: claim.withdrawal.payoutDestination.accountName,
        reference: claim.withdrawal.providerReference,
        narration: 'LeamJobs wallet withdrawal',
        currency: claim.withdrawal.currency,
        debitCurrency: claim.withdrawal.currency,
        ...(meta ? { meta } : {}),
      })
      : await createLegacyPaystackTransfer({ withdrawal: claim.withdrawal, accountNumber });
    const transferId = payoutProvider === 'FLUTTERWAVE' ? transfer?.id : transfer?.transfer_code;
    const transferIdMissing = payoutProvider === 'FLUTTERWAVE' && !transferId;
    const manualReviewMessage = 'Flutterwave returned no transfer ID. Keep the withdrawal reserved and reconcile manually; do not submit another payout.';
    if (transferId) {
      await associateAttemptTransfer(claim.attemptId, transferId, { failureReason: null });
    } else {
      await updateAttempt(claim.attemptId, { failureReason: manualReviewMessage });
    }
    const status = payoutProvider === 'FLUTTERWAVE'
      ? normalizeFlutterwaveTransferStatus(transfer.status)
      : normalizePaystackTransferStatus(transfer.status);
    if (status === 'PROCESSING') {
      if (transferIdMissing) {
        await prisma.$transaction(async (transaction) => {
          await transaction.withdrawal.updateMany({
            where: { id: withdrawalId, status: 'PROCESSING' },
            data: { failureReason: manualReviewMessage },
          });
          await transaction.payout.updateMany({
            where: { id: claim.payoutId, status: 'PROCESSING' },
            data: { failureReason: manualReviewMessage },
          });
        });
      }
      return {
        status: 'PROCESSING',
        unresolved: true,
        ...(transferIdMissing ? { manualReviewRequired: true, message: manualReviewMessage } : {}),
      };
    }
    return applyOutcome({ withdrawalId, status, providerTransfer: transfer });
  } catch (error) {
    const definitiveRejection = payoutProvider === 'FLUTTERWAVE'
      ? error?.name === 'FlutterwaveRequestError' && !error.outcomeUnknown && [422, 503].includes(error.status)
      : error?.name === 'PaystackRequestError' && error.retryable === false;
    if (definitiveRejection) {
      const failureAmount = payoutProvider === 'PAYSTACK'
        ? Number(new Prisma.Decimal(claim.withdrawal.payout.amount).mul(100))
        : claim.withdrawal.payout.amount.toString();
      const failedTransfer = { amount: failureAmount, currency: claim.withdrawal.currency, reference: claim.withdrawal.providerReference, failure_reason: `${payoutProvider} rejected the withdrawal request` };
      return applyOutcome({ withdrawalId, status: 'FAILED', providerTransfer: failedTransfer, preSubmissionFailure: true });
    }
    const manualReviewRequired = payoutProvider === 'FLUTTERWAVE' && Boolean(error.outcomeUnknown);
    const failureReason = error.transferAssociationConflict
      ? 'A conflicting provider transfer ID is associated with this attempt. Keep the withdrawal reserved and reconcile manually; do not submit another payout.'
      : manualReviewRequired
        ? 'Flutterwave may have accepted the transfer, but no transfer ID was recorded. Keep the withdrawal reserved and reconcile manually; do not submit another payout.'
        : `${payoutProvider} transfer request outcome requires reconciliation`;
    await updateAttempt(claim.attemptId, { status: 'PROCESSING', failureReason });
    if (manualReviewRequired) {
      await prisma.$transaction(async (transaction) => {
        await transaction.withdrawal.updateMany({
          where: { id: withdrawalId, status: 'PROCESSING' },
          data: { failureReason },
        });
        await transaction.payout.updateMany({
          where: { id: claim.payoutId, status: 'PROCESSING' },
          data: { failureReason },
        });
      });
    }
    return {
      status: 'PROCESSING',
      unresolved: true,
      ...(manualReviewRequired || error.transferAssociationConflict ? { manualReviewRequired: true, message: failureReason } : {}),
      retryable: payoutProvider === 'PAYSTACK' ? error.retryable !== false : Boolean(error.outcomeUnknown),
    };
  }
};

export const executePendingWithdrawals = async ({ batchSize = 25 } = {}) => {
  const features = resolveFreelancePaymentFeatures();
  if (!features.withdrawalsEnabled) return [];
  const currencyFilter = isWithdrawalCurrencyEnabled('USD', features)
    ? { currency: { in: ['NGN', 'USD'] } }
    : { currency: 'NGN' };
  const withdrawals = await prisma.withdrawal.findMany({ where: { status: 'PENDING', ...currencyFilter }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.min(Math.max(Number(batchSize) || 25, 1), 100), select: { id: true } });
  const results = [];
  for (const withdrawal of withdrawals) {
    try {
      results.push(await executeWithdrawal(withdrawal.id));
    } catch (error) {
      results.push(error?.preSubmissionFailure
        ? { status: 'PENDING', unresolved: true, manualReviewRequired: true, message: error.message }
        : { status: 'PROCESSING', unresolved: true });
    }
  }
  return results;
};

export const reconcilePendingWithdrawals = async ({ batchSize = 25 } = {}) => {
  const withdrawals = await prisma.withdrawal.findMany({ where: { status: 'PROCESSING', provider: { in: ['PAYSTACK', 'FLUTTERWAVE'] } }, orderBy: [{ processingAt: 'asc' }, { id: 'asc' }], take: Math.min(Math.max(Number(batchSize) || 25, 1), 100), select: { id: true } });
  const results = [];
  for (const withdrawal of withdrawals) {
    try { results.push(await reconcileWithdrawal(withdrawal.id)); } catch { results.push({ status: 'PROCESSING', unresolved: true }); }
  }
  return results;
};
