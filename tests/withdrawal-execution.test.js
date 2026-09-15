import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'withdrawal-execution-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  $transaction: jest.fn(),
  withdrawal: { findUnique: jest.fn(), findMany: jest.fn() },
  payoutAttempt: { update: jest.fn().mockResolvedValue({}) },
};
const paystack = {
  isPaystackConfigured: jest.fn(() => true),
  createPaystackTransferRecipient: jest.fn(),
  createPaystackTransfer: jest.fn(),
  getPaystackTransferByReference: jest.fn(),
  getPaystackTransferByCode: jest.fn(),
  normalizePaystackTransferStatus: jest.fn((status) => status === 'success' ? 'SUCCESSFUL' : status === 'failed' ? 'FAILED' : status === 'reversed' ? 'REVERSED' : 'PROCESSING'),
};
const decryptPayoutIdentifier = jest.fn(() => '0123456789');
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/utils/payoutEncryption.js', () => ({ decryptPayoutIdentifier }));
jest.unstable_mockModule('../src/services/paystack.service.js', () => paystack);
const { executeWithdrawal, reconcileWithdrawal, withdrawalReference } = await import('../src/services/withdrawalExecution.service.js');

const withdrawalId = 'withdrawal-1';
const baseWithdrawal = {
  id: withdrawalId,
  walletId: 'wallet-1',
  seekerId: 'seeker-1',
  payoutAccountId: 'account-1',
  amount: new Prisma.Decimal('80000.00'),
  currency: 'NGN',
  status: 'PENDING',
  provider: 'PAYSTACK',
  providerReference: null,
  payoutAccount: { userId: 'seeker-1', provider: 'PAYSTACK', currency: 'NGN', bankCode: '058', accountName: 'Jane Doe', encryptedAccountNumber: 'encrypted', verifiedAt: new Date(), disabledAt: null },
  payout: null,
};

const setupTransaction = ({ finalStatus = 'SUCCESSFUL' } = {}) => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    withdrawal: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
    payout: { create: jest.fn().mockResolvedValue({ id: 'payout-1', providerReference: 'lj_wd_withdrawal-1', status: 'PROCESSING' }), update: jest.fn() },
    payoutAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'attempt-1' }), findFirst: jest.fn().mockResolvedValue({ id: 'attempt-1' }), update: jest.fn() },
    wallet: { update: jest.fn() },
    financialLedgerEntry: { create: jest.fn() },
  };
  const processing = { ...baseWithdrawal, status: 'PROCESSING', providerReference: 'lj_wd_withdrawal-1', payout: { id: 'payout-1' } };
  tx.withdrawal.findUnique.mockResolvedValueOnce(baseWithdrawal).mockResolvedValueOnce(processing);
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: new Prisma.Decimal('80000.00'), availableBalance: new Prisma.Decimal('20000.00') }]);
  mockPrisma.withdrawal.findUnique.mockResolvedValue(processing);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
  return tx;
};

beforeEach(() => {
  jest.clearAllMocks();
  paystack.createPaystackTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_test' });
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 8000000, currency: 'NGN' });
});

test('generates a deterministic Paystack reference within the 50-character limit', () => {
  const withdrawalId = '12345678-1234-4234-8234-123456789012';
  expect(withdrawalReference(withdrawalId)).toBe('lj_wd_12345678-1234-4234-8234-123456789012');
  expect(withdrawalReference(withdrawalId)).toHaveLength(42);
  expect(withdrawalReference(withdrawalId).length).toBeLessThanOrEqual(50);
});

test('successful Paystack transfer finalizes the reservation once', async () => {
  const tx = setupTransaction();
  const result = await executeWithdrawal(withdrawalId);
  expect(result.status).toBe('SUCCESSFUL');
  expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pendingWithdrawalBalance: { decrement: new Prisma.Decimal('80000.00') } }) }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_SUCCESSFUL', idempotencyKey: `${withdrawalId}:successful` }) }));
});

test('confirmed Paystack failure releases the reservation exactly once', async () => {
  const tx = setupTransaction({ finalStatus: 'FAILED' });
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'failed', amount: 8000000, currency: 'NGN', failure_reason: 'rejected' });
  const result = await executeWithdrawal(withdrawalId);
  expect(result.status).toBe('FAILED');
  expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ availableBalance: { increment: new Prisma.Decimal('80000.00') }, pendingWithdrawalBalance: { decrement: new Prisma.Decimal('80000.00') } }) }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL', idempotencyKey: `${withdrawalId}:failed-reversal` }) }));
});

test('pending provider status preserves the wallet reservation', async () => {
  const tx = setupTransaction();
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'pending', amount: 8000000, currency: 'NGN' });
  paystack.getPaystackTransferByReference.mockResolvedValue({ reference: 'lj_wd_withdrawal-1', status: 'pending' });
  const result = await executeWithdrawal(withdrawalId);
  expect(result.status).toBe('PROCESSING');
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('already-finalized reconciliation performs no financial mutation', async () => {
  const tx = setupTransaction();
  mockPrisma.withdrawal.findUnique.mockResolvedValue({ id: withdrawalId, status: 'SUCCESSFUL', provider: 'PAYSTACK', providerReference: 'lj_wd_withdrawal-1', payout: { attempts: [{ providerReference: 'TRF_test' }] } });
  paystack.getPaystackTransferByCode.mockResolvedValue({ transfer_code: 'TRF_test', status: 'success', amount: 8000000, currency: 'NGN' });
  tx.withdrawal.findUnique.mockReset().mockResolvedValue({ id: withdrawalId, walletId: 'wallet-1', amount: new Prisma.Decimal('80000.00'), currency: 'NGN', status: 'SUCCESSFUL', providerReference: 'lj_wd_withdrawal-1', payout: { id: 'payout-1' } });
  const result = await reconcileWithdrawal(withdrawalId);
  expect(result).toEqual({ alreadyFinalized: true, status: 'SUCCESSFUL' });
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('a Paystack reversal after success restores available balance once', async () => {
  const tx = setupTransaction({ finalStatus: 'FAILED' });
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    status: 'SUCCESSFUL',
    provider: 'PAYSTACK',
    providerReference: 'lj_wd_withdrawal-1',
    payout: { attempts: [{ providerReference: 'TRF_test' }] },
  });
  paystack.getPaystackTransferByCode.mockResolvedValue({ transfer_code: 'TRF_test', status: 'reversed', amount: 8000000, currency: 'NGN' });
  tx.withdrawal.findUnique.mockReset().mockResolvedValue({ id: withdrawalId, walletId: 'wallet-1', amount: new Prisma.Decimal('80000.00'), currency: 'NGN', status: 'SUCCESSFUL', providerReference: 'lj_wd_withdrawal-1', payout: { id: 'payout-1' } });
  tx.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: new Prisma.Decimal('0.00'), availableBalance: new Prisma.Decimal('20000.00') }]);
  const result = await reconcileWithdrawal(withdrawalId);
  expect(result.status).toBe('FAILED');
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL', idempotencyKey: `${withdrawalId}:failed-reversal` }) }));
});

test('amount mismatch does not finalize a provider result', async () => {
  const tx = setupTransaction();
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'lj_wd_transfer', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 800000, currency: 'NGN' });
  await expect(executeWithdrawal(withdrawalId)).rejects.toThrow(/amount or currency/);
  expect(tx.wallet.update).not.toHaveBeenCalled();
});

test('non-retryable Paystack rejection releases the protected reservation', async () => {
  const tx = setupTransaction({ finalStatus: 'FAILED' });
  paystack.createPaystackTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { name: 'PaystackRequestError', retryable: false }));
  const result = await executeWithdrawal(withdrawalId);
  expect(result.status).toBe('FAILED');
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }) }));
});
