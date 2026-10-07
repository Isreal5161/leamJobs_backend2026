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
  processingAt: true,
  payoutAccount: { select: { userId: true, provider: true, payoutMethod: true, country: true, currency: true, bankCode: true, bankName: true, accountName: true, encryptedAccountNumber: true, verifiedAt: true, disabledAt: true } },
  payout: { select: { id: true, amount: true, providerReference: true, status: true } },
};

const providerError = (message, status = 422) => Object.assign(new Error(message), { status });

const createLegacyPaystackTransfer = async ({ withdrawal, accountNumber }) => {
  const recipient = await createPaystackTransferRecipient({
    name: withdrawal.payoutAccount.accountName,
    accountNumber,
    bankCode: withdrawal.payoutAccount.bankCode,
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
  const payoutProvider = withdrawal.payoutAccount.provider;
  if (!['FLUTTERWAVE', 'PAYSTACK'].includes(payoutProvider)) throw providerError('This payout account is not configured for bank withdrawals', 422);
  if (withdrawal.provider && withdrawal.provider !== payoutProvider) throw providerError('Withdrawal provider does not match its payout account', 409);
  if (withdrawal.payoutAccount.userId !== withdrawal.seekerId) throw providerError('The payout account does not belong to the withdrawal owner', 403);
  if (withdrawal.payoutAccount.disabledAt) throw providerError('The payout account is disabled', 422);
  if (payoutProvider === 'PAYSTACK' && !withdrawal.payoutAccount.verifiedAt) {
    throw providerError('The legacy Paystack payout account is no longer verified', 422);
  }
  if (payoutProvider === 'FLUTTERWAVE' && !isSupportedPayoutAccount(withdrawal.payoutAccount)) {
    throw providerError('The Flutterwave payout account is not supported or validated', 422);
  }
  if (withdrawal.currency !== withdrawal.payoutAccount.currency) throw providerError('Withdrawal currency does not match the payout account', 422);
  if (payoutProvider === 'FLUTTERWAVE' && withdrawal.payoutAccount.country === 'Nigeria' && !withdrawal.payoutAccount.verifiedAt) {
    throw providerError('The Nigerian payout account is no longer verified', 422);
  }
  if (!/^\d{3,20}$/.test(String(withdrawal.payoutAccount.bankCode ?? ''))) throw providerError('The payout account is missing a valid bank code', 422);

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
  return { withdrawal: { ...withdrawal, providerReference: reference, payout: { ...payout, id: payout.id } }, attemptId: attempt.id, payoutId: payout.id };
});

const updateAttempt = async (attemptId, data) => prisma.payoutAttempt.update({ where: { id: attemptId }, data }).catch(() => undefined);

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

const applyOutcome = async ({ withdrawalId, status, providerTransfer }) => prisma.$transaction(async (transaction) => {
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
  if (status === 'SUCCESSFUL' || status === 'FAILED' || isReversal) assertTransferMatchesWithdrawal(withdrawal, providerTransfer, provider);
  const attempt = await transaction.payoutAttempt.findFirst({ where: { payoutId: withdrawal.payout.id, ...(isReversal ? {} : { status: { in: ['PROCESSING', 'PENDING'] } }) }, orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }], select: { id: true } });
  if (status === 'SUCCESSFUL') {
    const walletRows = await transaction.$queryRaw`SELECT "id", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount)) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { pendingWithdrawalBalance: { decrement: withdrawal.amount }, version: { increment: 1 } } });
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'SUCCESSFUL', completedAt: new Date(), failureReason: null } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'SUCCESSFUL', processedAt: new Date(), providerReference } });
    if (attempt) await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCESSFUL', processedAt: new Date(), providerReference: providerTransfer?.id ? String(providerTransfer.id) : providerReference } });
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_SUCCESSFUL', amount: withdrawal.payout.amount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:successful`, description: `Net withdrawal payout completed by ${provider}`, walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    if (withdrawalFeeAmount.gt(0)) {
      await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FEE', amount: withdrawalFeeAmount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:fee`, description: 'Platform withdrawal charge collected', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    }
    return { status: 'SUCCESSFUL' };
  }

  if (status === 'FAILED' || isReversal) {
    const walletRows = await transaction.$queryRaw`SELECT "id", "availableBalance", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || (!isReversal && new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount))) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { availableBalance: { increment: withdrawal.amount }, ...(isReversal ? {} : { pendingWithdrawalBalance: { decrement: withdrawal.amount } }), version: { increment: 1 } } });
    const failureReason = providerTransfer?.failure_reason || providerTransfer?.complete_message || `${provider} transfer failed`;
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason, providerReference } });
    if (attempt) await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', processedAt: new Date(), failureReason, providerReference: providerTransfer?.id ? String(providerTransfer.id) : providerReference } });
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FAILED_REVERSAL', amount: withdrawal.amount, currency: withdrawal.currency, balanceAfter: new Prisma.Decimal(wallet.availableBalance).plus(withdrawal.amount), idempotencyKey: `${withdrawal.id}:failed-reversal`, description: isReversal ? `${provider} withdrawal reversed after payout success` : `Withdrawal reservation released after ${provider} failure`, walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    if (isReversal && withdrawalFeeAmount.gt(0)) {
      await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FEE_REVERSAL', amount: withdrawalFeeAmount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:fee-reversal`, description: 'Platform withdrawal charge reversed after payout reversal', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    }
    return { status: 'FAILED' };
  }

  return { status: 'PROCESSING' };
});

export const reconcileWithdrawal = async (withdrawalId) => {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, select: { id: true, status: true, provider: true, providerReference: true, payout: { select: { attempts: { where: { providerReference: { not: null } }, orderBy: [{ attemptNumber: 'desc' }], take: 1, select: { providerReference: true } } } } } });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(withdrawal.status) && withdrawal.status !== 'SUCCESSFUL') return { alreadyFinalized: true, status: withdrawal.status };
  if (!['PAYSTACK', 'FLUTTERWAVE'].includes(withdrawal.provider) || !withdrawal.providerReference) throw providerError('Withdrawal is not ready for provider reconciliation', 422);
  const transferCode = withdrawal.payout?.attempts?.[0]?.providerReference;
  if (withdrawal.provider === 'FLUTTERWAVE' && !transferCode) return { status: 'PROCESSING', unresolved: true };
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

export const executeWithdrawal = async (withdrawalId) => {
  const payoutAccount = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, select: { payoutAccount: { select: { provider: true } } } });
  if (!payoutAccount) throw providerError('Withdrawal not found', 404);
  const payoutProvider = payoutAccount.payoutAccount.provider;
  if (payoutProvider === 'FLUTTERWAVE' && !isFlutterwaveConfigured()) throw providerError('Flutterwave payout configuration is unavailable', 503);
  if (payoutProvider === 'PAYSTACK' && !isPaystackConfigured()) throw providerError('Paystack payout configuration is unavailable', 503);
  const claim = await claimWithdrawal(withdrawalId);
  if (claim.finalized || claim.processing) return { status: claim.withdrawal.status, alreadyHandled: true };
  try {
    const accountNumber = decryptPayoutIdentifier(claim.withdrawal.payoutAccount.encryptedAccountNumber);
    const transfer = payoutProvider === 'FLUTTERWAVE'
      ? await createFlutterwaveTransfer({
        amount: claim.withdrawal.payout.amount.toString(),
        accountNumber,
        bankCode: claim.withdrawal.payoutAccount.bankCode,
        beneficiaryName: claim.withdrawal.payoutAccount.accountName,
        reference: claim.withdrawal.providerReference,
        narration: 'LeamJobs wallet withdrawal',
        currency: claim.withdrawal.currency,
        debitCurrency: claim.withdrawal.currency,
      })
      : await createLegacyPaystackTransfer({ withdrawal: claim.withdrawal, accountNumber });
    const transferId = payoutProvider === 'FLUTTERWAVE' ? transfer?.id : transfer?.transfer_code;
    await updateAttempt(claim.attemptId, { providerReference: transferId ? String(transferId) : null, failureReason: null });
    const status = payoutProvider === 'FLUTTERWAVE'
      ? normalizeFlutterwaveTransferStatus(transfer.status)
      : normalizePaystackTransferStatus(transfer.status);
    if (status === 'PROCESSING') return { status: 'PROCESSING', unresolved: true };
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
      return applyOutcome({ withdrawalId, status: 'FAILED', providerTransfer: failedTransfer });
    }
    await updateAttempt(claim.attemptId, { status: 'PROCESSING', failureReason: `${payoutProvider} transfer request outcome requires reconciliation` });
    return { status: 'PROCESSING', unresolved: true, retryable: payoutProvider === 'PAYSTACK' ? error.retryable !== false : Boolean(error.outcomeUnknown) };
  }
};

export const executePendingWithdrawals = async ({ batchSize = 25 } = {}) => {
  const withdrawals = await prisma.withdrawal.findMany({ where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.min(Math.max(Number(batchSize) || 25, 1), 100), select: { id: true } });
  const results = [];
  for (const withdrawal of withdrawals) {
    try { results.push(await executeWithdrawal(withdrawal.id)); } catch { results.push({ status: 'PROCESSING', unresolved: true }); }
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
