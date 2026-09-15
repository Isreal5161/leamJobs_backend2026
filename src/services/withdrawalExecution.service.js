import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { decryptPayoutIdentifier } from '../utils/payoutEncryption.js';
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
  currency: true,
  status: true,
  provider: true,
  providerReference: true,
  processingAt: true,
  payoutAccount: { select: { userId: true, provider: true, currency: true, bankCode: true, accountName: true, encryptedAccountNumber: true, verifiedAt: true, disabledAt: true } },
  payout: { select: { id: true, providerReference: true, status: true } },
};

const providerError = (message, status = 422) => Object.assign(new Error(message), { status });

const claimWithdrawal = async (withdrawalId) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId} FOR UPDATE`;
  const withdrawal = await transaction.withdrawal.findUnique({ where: { id: withdrawalId }, select: withdrawalDetails });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(withdrawal.status)) return { finalized: true, withdrawal };
  if (withdrawal.status === 'PROCESSING') return { processing: true, withdrawal };
  if (withdrawal.provider && withdrawal.provider !== 'PAYSTACK') throw providerError('This withdrawal is not configured for Paystack', 422);
  if (withdrawal.payoutAccount.userId !== withdrawal.seekerId) throw providerError('The payout account does not belong to the withdrawal owner', 403);
  if (!withdrawal.payoutAccount.verifiedAt || withdrawal.payoutAccount.disabledAt) throw providerError('The payout account is no longer verified and enabled', 422);
  if (withdrawal.currency !== 'NGN' || withdrawal.payoutAccount.provider !== 'PAYSTACK' || withdrawal.payoutAccount.currency !== 'NGN') throw providerError('Only verified Nigerian Paystack bank accounts are supported for withdrawals', 422);
  if (!/^\d{3,6}$/.test(String(withdrawal.payoutAccount.bankCode ?? ''))) throw providerError('The payout account is missing a valid Paystack bank code', 422);

  const reference = withdrawal.providerReference || withdrawalReference(withdrawal.id);
  const payout = withdrawal.payout ?? await transaction.payout.create({
    data: {
      withdrawalId: withdrawal.id,
      recipientUserId: withdrawal.seekerId,
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      provider: 'PAYSTACK',
      providerReference: reference,
      status: 'PROCESSING',
    },
    select: { id: true, providerReference: true, status: true },
  });
  const attemptCount = await transaction.payoutAttempt.count({ where: { payoutId: payout.id } });
  const attempt = await transaction.payoutAttempt.create({ data: { payoutId: payout.id, attemptNumber: attemptCount + 1, status: 'PROCESSING' }, select: { id: true } });
  const claimed = await transaction.withdrawal.updateMany({ where: { id: withdrawal.id, status: 'PENDING' }, data: { status: 'PROCESSING', provider: 'PAYSTACK', providerReference: reference, processingAt: new Date() } });
  if (claimed.count !== 1) return { processing: true, withdrawal };
  await transaction.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING', provider: 'PAYSTACK', providerReference: reference } });
  return { withdrawal: { ...withdrawal, providerReference: reference, payout: { ...payout, id: payout.id } }, attemptId: attempt.id, payoutId: payout.id };
});

const updateAttempt = async (attemptId, data) => prisma.payoutAttempt.update({ where: { id: attemptId }, data }).catch(() => undefined);

const assertTransferMatchesWithdrawal = (withdrawal, providerTransfer) => {
  const providerAmount = Number(providerTransfer?.amount);
  const expectedAmount = Number(new Prisma.Decimal(withdrawal.amount).mul(100));
  const providerCurrency = String(providerTransfer?.currency ?? '').toUpperCase();
  if (!Number.isSafeInteger(providerAmount) || providerAmount !== expectedAmount || providerCurrency !== String(withdrawal.currency).toUpperCase()) {
    throw providerError('Paystack transfer amount or currency does not match the withdrawal', 409);
  }
};

const applyOutcome = async ({ withdrawalId, status, providerTransfer }) => prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT "id" FROM "Withdrawal" WHERE "id" = ${withdrawalId} FOR UPDATE`;
  const withdrawal = await transaction.withdrawal.findUnique({ where: { id: withdrawalId }, select: { id: true, walletId: true, amount: true, currency: true, status: true, providerReference: true, payout: { select: { id: true } } } });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  const isReversal = status === 'REVERSED';
  if (finalizedStatuses.has(withdrawal.status) && !(isReversal && withdrawal.status === 'SUCCESSFUL')) return { alreadyFinalized: true, status: withdrawal.status };
  if (!withdrawal.payout) throw providerError('Withdrawal payout record is missing', 409);

  const providerReference = providerTransfer?.transfer_code ? String(providerTransfer.transfer_code) : null;
  if (status === 'SUCCESSFUL' || status === 'FAILED' || isReversal) assertTransferMatchesWithdrawal(withdrawal, providerTransfer);
  const attempt = await transaction.payoutAttempt.findFirst({ where: { payoutId: withdrawal.payout.id, ...(isReversal ? {} : { status: { in: ['PROCESSING', 'PENDING'] } }) }, orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }], select: { id: true } });
  if (status === 'SUCCESSFUL') {
    const walletRows = await transaction.$queryRaw`SELECT "id", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount)) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { pendingWithdrawalBalance: { decrement: withdrawal.amount }, version: { increment: 1 } } });
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'SUCCESSFUL', completedAt: new Date(), failureReason: null } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'SUCCESSFUL', processedAt: new Date(), providerReference } });
    if (attempt) await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCESSFUL', processedAt: new Date(), providerReference } });
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_SUCCESSFUL', amount: withdrawal.amount, currency: withdrawal.currency, idempotencyKey: `${withdrawal.id}:successful`, description: 'Withdrawal completed by Paystack', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    return { status: 'SUCCESSFUL' };
  }

  if (status === 'FAILED' || isReversal) {
    const walletRows = await transaction.$queryRaw`SELECT "id", "availableBalance", "pendingWithdrawalBalance" FROM "Wallet" WHERE "id" = ${withdrawal.walletId} FOR UPDATE`;
    const wallet = walletRows[0];
    if (!wallet || (!isReversal && new Prisma.Decimal(wallet.pendingWithdrawalBalance).lt(withdrawal.amount))) throw providerError('Reserved withdrawal balance is inconsistent', 409);
    await transaction.wallet.update({ where: { id: withdrawal.walletId }, data: { availableBalance: { increment: withdrawal.amount }, ...(isReversal ? {} : { pendingWithdrawalBalance: { decrement: withdrawal.amount } }), version: { increment: 1 } } });
    await transaction.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: providerTransfer?.failure_reason || 'Paystack transfer failed' } });
    await transaction.payout.update({ where: { id: withdrawal.payout.id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: providerTransfer?.failure_reason || 'Paystack transfer failed', providerReference } });
    if (attempt) await transaction.payoutAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', processedAt: new Date(), failureReason: providerTransfer?.failure_reason || 'Paystack transfer failed', providerReference } });
    await transaction.financialLedgerEntry.create({ data: { entryType: 'WITHDRAWAL_FAILED_REVERSAL', amount: withdrawal.amount, currency: withdrawal.currency, balanceAfter: new Prisma.Decimal(wallet.availableBalance).plus(withdrawal.amount), idempotencyKey: `${withdrawal.id}:failed-reversal`, description: isReversal ? 'Paystack withdrawal reversed after payout success' : 'Withdrawal reservation released after Paystack failure', walletId: withdrawal.walletId, withdrawalId: withdrawal.id, payoutId: withdrawal.payout.id } });
    return { status: 'FAILED' };
  }

  return { status: 'PROCESSING' };
});

export const reconcileWithdrawal = async (withdrawalId) => {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId }, select: { id: true, status: true, provider: true, providerReference: true, payout: { select: { attempts: { where: { providerReference: { not: null } }, orderBy: [{ attemptNumber: 'desc' }], take: 1, select: { providerReference: true } } } } } });
  if (!withdrawal) throw providerError('Withdrawal not found', 404);
  if (finalizedStatuses.has(withdrawal.status) && withdrawal.status !== 'SUCCESSFUL') return { alreadyFinalized: true, status: withdrawal.status };
  if (withdrawal.provider !== 'PAYSTACK' || !withdrawal.providerReference) throw providerError('Withdrawal is not ready for Paystack reconciliation', 422);
  const transferCode = withdrawal.payout?.attempts?.[0]?.providerReference;
  const transfer = transferCode
    ? await getPaystackTransferByCode(transferCode)
    : await getPaystackTransferByReference(withdrawal.providerReference);
  if (!transfer) return { status: 'PROCESSING', unresolved: true };
  return applyOutcome({ withdrawalId, status: normalizePaystackTransferStatus(transfer.status), providerTransfer: transfer });
};

export const executeWithdrawal = async (withdrawalId) => {
  if (!isPaystackConfigured()) throw providerError('Paystack payout configuration is unavailable', 503);
  const claim = await claimWithdrawal(withdrawalId);
  if (claim.finalized || claim.processing) return { status: claim.withdrawal.status, alreadyHandled: true };
  try {
    const accountNumber = decryptPayoutIdentifier(claim.withdrawal.payoutAccount.encryptedAccountNumber);
    const recipient = await createPaystackTransferRecipient({ name: claim.withdrawal.payoutAccount.accountName, accountNumber, bankCode: claim.withdrawal.payoutAccount.bankCode });
    if (!recipient?.recipient_code) throw providerError('Paystack did not return a payout recipient', 502);
    const transfer = await createPaystackTransfer({ amount: claim.withdrawal.amount.toString(), recipientCode: recipient.recipient_code, reference: claim.withdrawal.providerReference, reason: 'LeamJobs wallet withdrawal' });
    if (!transfer) throw providerError('Paystack did not return a transfer result', 502);
    await updateAttempt(claim.attemptId, { providerReference: transfer.transfer_code ? String(transfer.transfer_code) : null, failureReason: null });
    const status = normalizePaystackTransferStatus(transfer.status);
    if (status === 'PROCESSING') return reconcileWithdrawal(withdrawalId);
    return applyOutcome({ withdrawalId, status, providerTransfer: transfer });
  } catch (error) {
    if (error?.name === 'PaystackRequestError' && error.retryable === false) {
      const failedTransfer = { amount: Number(new Prisma.Decimal(claim.withdrawal.amount).mul(100)), currency: claim.withdrawal.currency, failure_reason: 'Paystack rejected the withdrawal request' };
      return applyOutcome({ withdrawalId, status: 'FAILED', providerTransfer: failedTransfer });
    }
    await updateAttempt(claim.attemptId, { status: 'PROCESSING', failureReason: error.message === 'Paystack payout configuration is unavailable' ? 'Paystack payout configuration unavailable' : 'Paystack transfer request failed' });
    return { status: 'PROCESSING', unresolved: true, retryable: error.retryable !== false };
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
  const withdrawals = await prisma.withdrawal.findMany({ where: { status: 'PROCESSING', provider: 'PAYSTACK' }, orderBy: [{ processingAt: 'asc' }, { id: 'asc' }], take: Math.min(Math.max(Number(batchSize) || 25, 1), 100), select: { id: true } });
  const results = [];
  for (const withdrawal of withdrawals) {
    try { results.push(await reconcileWithdrawal(withdrawal.id)); } catch { results.push({ status: 'PROCESSING', unresolved: true }); }
  }
  return results;
};
