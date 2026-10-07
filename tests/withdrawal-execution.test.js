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
const flutterwave = {
  isFlutterwaveConfigured: jest.fn(() => true),
  createFlutterwaveTransfer: jest.fn(),
  getFlutterwaveTransferById: jest.fn(),
  normalizeFlutterwaveTransferStatus: jest.fn((status) => ['SUCCESSFUL', 'FAILED', 'REVERSED'].includes(status) ? status : 'PROCESSING'),
};
const decryptPayoutIdentifier = jest.fn((value) => value === 'encrypted-us-meta'
  ? JSON.stringify({
    routing_number: '101019644',
    swift_code: 'IRVTUS3N',
    bank_name: 'BANK OF AMERICA, N.A.',
    account_type: 'checking',
    beneficiary_address: '4 Newton Street, San Francisco',
    postal_code: '94105',
    street_number: '4',
    street_name: 'Newton Street',
  })
  : '0123456789');
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/utils/payoutEncryption.js', () => ({ decryptPayoutIdentifier }));
jest.unstable_mockModule('../src/services/paystack.service.js', () => paystack);
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => flutterwave);
const { executeWithdrawal, reconcileWithdrawal, withdrawalReference } = await import('../src/services/withdrawalExecution.service.js');

const withdrawalId = 'withdrawal-1';
const baseWithdrawal = {
  id: withdrawalId,
  walletId: 'wallet-1',
  seekerId: 'seeker-1',
  payoutAccountId: 'account-1',
  amount: new Prisma.Decimal('80000.00'),
  withdrawalFeeAmount: new Prisma.Decimal('0.00'),
  payoutAmount: new Prisma.Decimal('80000.00'),
  currency: 'NGN',
  status: 'PENDING',
  provider: 'PAYSTACK',
  providerReference: null,
  payoutAccount: { userId: 'seeker-1', provider: 'PAYSTACK', payoutMethod: 'BANK_ACCOUNT', country: 'Nigeria', currency: 'NGN', bankCode: '058', accountName: 'Jane Doe', encryptedAccountNumber: 'encrypted', verifiedAt: new Date(), disabledAt: null },
  payout: null,
};

const setupTransaction = ({ finalStatus = 'SUCCESSFUL', withdrawal = baseWithdrawal } = {}) => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    withdrawal: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
    payout: { create: jest.fn().mockImplementation(({ data }) => ({ id: 'payout-1', amount: data.amount, providerReference: 'lj_wd_withdrawal-1', status: 'PROCESSING' })), update: jest.fn() },
    payoutAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'attempt-1' }), findFirst: jest.fn().mockResolvedValue({ id: 'attempt-1' }), update: jest.fn() },
    wallet: { update: jest.fn() },
    financialLedgerEntry: { create: jest.fn() },
  };
  const processing = { ...withdrawal, status: 'PROCESSING', provider: withdrawal.provider ?? withdrawal.payoutAccount.provider, providerReference: 'lj_wd_withdrawal-1', payout: { id: 'payout-1', amount: withdrawal.payoutAmount } };
  tx.withdrawal.findUnique.mockResolvedValueOnce(withdrawal).mockResolvedValueOnce(processing);
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: withdrawal.amount, availableBalance: new Prisma.Decimal('20000.00') }]);
  mockPrisma.withdrawal.findUnique.mockResolvedValue(processing);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
  return tx;
};

beforeEach(() => {
  jest.clearAllMocks();
  paystack.createPaystackTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_test' });
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 8000000, currency: 'NGN' });
  flutterwave.createFlutterwaveTransfer.mockResolvedValue({ id: 12345, reference: 'lj_wd_withdrawal-1', status: 'SUCCESSFUL', amount: 80000, currency: 'NGN' });
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

test('new Flutterwave payouts send the saved net NGN amount in naira and finalize the reservation', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockResolvedValue({
    id: 12345,
    reference: 'lj_wd_withdrawal-1',
    status: 'SUCCESSFUL',
    amount: 80000,
    currency: 'NGN',
  });

  const result = await executeWithdrawal(withdrawalId);

  expect(result.status).toBe('SUCCESSFUL');
  expect(tx.payout.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ provider: 'FLUTTERWAVE', amount: new Prisma.Decimal('80000.00') }),
  }));
  expect(flutterwave.createFlutterwaveTransfer).toHaveBeenCalledWith(expect.objectContaining({
    amount: '80000',
    accountNumber: '0123456789',
    bankCode: '058',
    beneficiaryName: 'Jane Doe',
  }));
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ pendingWithdrawalBalance: { decrement: new Prisma.Decimal('80000.00') } }),
  }));
});

test('does not execute a legacy US/USD withdrawal as a currently supported payout', async () => {
  const usWithdrawal = {
    ...baseWithdrawal,
    currency: 'USD',
    provider: 'FLUTTERWAVE',
    payoutAccount: {
      ...baseWithdrawal.payoutAccount,
      provider: 'FLUTTERWAVE',
      country: 'United States',
      currency: 'USD',
      bankCode: '101019644',
      encryptedPayoutMetadata: 'encrypted-us-meta',
      verifiedAt: null,
    },
  };
  const tx = setupTransaction({ withdrawal: usWithdrawal });

  await expect(executeWithdrawal(withdrawalId)).rejects.toThrow(/not supported or validated/i);

  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(tx.payout.create).not.toHaveBeenCalled();
});

test('Flutterwave transfer failures release the gross reservation', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockResolvedValue({
    id: 12346,
    reference: 'lj_wd_withdrawal-1',
    status: 'FAILED',
    amount: 80000,
    currency: 'NGN',
    complete_message: 'Bank rejected transfer',
  });

  const result = await executeWithdrawal(withdrawalId);

  expect(result.status).toBe('FAILED');
  expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      availableBalance: { increment: new Prisma.Decimal('80000.00') },
      pendingWithdrawalBalance: { decrement: new Prisma.Decimal('80000.00') },
    }),
  }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }),
  }));
});

test('an unknown Flutterwave transfer outcome keeps the reservation pending to prevent duplicate payouts', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockRejectedValue(Object.assign(new Error('timeout'), {
    name: 'FlutterwaveRequestError',
    outcomeUnknown: true,
    status: 502,
  }));

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({ status: 'PROCESSING', unresolved: true });
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.payoutAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PROCESSING' }),
  }));
});

test('pays the saved net amount and records the withdrawal charge separately', async () => {
  const feeWithdrawal = {
    ...baseWithdrawal,
    withdrawalFeeAmount: new Prisma.Decimal('4000.00'),
    payoutAmount: new Prisma.Decimal('76000.00'),
  };
  const tx = setupTransaction({ withdrawal: feeWithdrawal });
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 7600000, currency: 'NGN' });

  const result = await executeWithdrawal(withdrawalId);

  expect(result.status).toBe('SUCCESSFUL');
  expect(tx.payout.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal('76000.00') }),
  }));
  expect(paystack.createPaystackTransfer).toHaveBeenCalledWith(expect.objectContaining({ amount: '76000' }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_SUCCESSFUL', amount: new Prisma.Decimal('76000.00') }),
  }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_FEE', amount: new Prisma.Decimal('4000.00'), idempotencyKey: `${withdrawalId}:fee` }),
  }));
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
  paystack.getPaystackTransferByCode.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'reversed', amount: 7600000, currency: 'NGN' });
  tx.withdrawal.findUnique.mockReset().mockResolvedValue({
    id: withdrawalId,
    walletId: 'wallet-1',
    amount: new Prisma.Decimal('80000.00'),
    withdrawalFeeAmount: new Prisma.Decimal('4000.00'),
    currency: 'NGN',
    status: 'SUCCESSFUL',
    provider: 'PAYSTACK',
    providerReference: 'lj_wd_withdrawal-1',
    payout: { id: 'payout-1', amount: new Prisma.Decimal('76000.00') },
  });
  tx.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: new Prisma.Decimal('0.00'), availableBalance: new Prisma.Decimal('20000.00') }]);
  const result = await reconcileWithdrawal(withdrawalId);
  expect(result.status).toBe('FAILED');
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL', idempotencyKey: `${withdrawalId}:failed-reversal` }) }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_FEE_REVERSAL', amount: new Prisma.Decimal('4000.00'), idempotencyKey: `${withdrawalId}:fee-reversal` }),
  }));
});

test('amount mismatch does not finalize a provider result', async () => {
  const tx = setupTransaction();
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'lj_wd_transfer', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 800000, currency: 'NGN' });
  await expect(executeWithdrawal(withdrawalId)).rejects.toThrow(/amount, or currency/);
  expect(tx.wallet.update).not.toHaveBeenCalled();
});

test('non-retryable Paystack rejection releases the protected reservation', async () => {
  const tx = setupTransaction({ finalStatus: 'FAILED' });
  paystack.createPaystackTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { name: 'PaystackRequestError', retryable: false }));
  const result = await executeWithdrawal(withdrawalId);
  expect(result.status).toBe('FAILED');
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }) }));
});
