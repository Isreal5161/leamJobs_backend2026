import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'withdrawal-execution-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = 'true';
process.env.LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED = 'true';
process.env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = 'false';

const mockPrisma = {
  $transaction: jest.fn(),
  withdrawal: { findUnique: jest.fn(), findMany: jest.fn() },
  payoutAttempt: { update: jest.fn().mockResolvedValue({}), findFirst: jest.fn(), updateMany: jest.fn() },
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
  : value === 'encrypted-transfer-metadata'
    ? JSON.stringify([{
      route: 'INTERNATIONAL_USD',
      routing_number: '101019644',
      swift_code: 'IRVTUS3N',
      bank_name: 'BANK OF AMERICA, N.A.',
      account_type: 'checking',
      beneficiary_address: '4 Newton Street, San Francisco',
      postal_code: '94105',
      street_number: '4',
      street_name: 'Newton Street',
      city: 'San Francisco',
    }])
  : '0123456789');
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/utils/payoutEncryption.js', () => ({ decryptPayoutIdentifier }));
jest.unstable_mockModule('../src/services/paystack.service.js', () => paystack);
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => flutterwave);
const {
  executePendingWithdrawals,
  executeWithdrawal,
  reconcileWithdrawal,
  recoverFlutterwaveTransfer,
  withdrawalReference,
} = await import('../src/services/withdrawalExecution.service.js');
const { env } = await import('../src/config/env.js');

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
  let latestAttemptReference = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    withdrawal: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
    payout: { create: jest.fn().mockImplementation(({ data }) => ({ id: 'payout-1', amount: data.amount, providerReference: 'lj_wd_withdrawal-1', status: 'PROCESSING' })), update: jest.fn(), updateMany: jest.fn() },
    payoutAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'attempt-1' }), findFirst: jest.fn().mockImplementation(async () => ({ id: 'attempt-1', providerReference: latestAttemptReference, status: 'PROCESSING' })), update: jest.fn(), updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
      const requestedReference = where.OR?.[1]?.providerReference;
      if (latestAttemptReference !== null && latestAttemptReference !== requestedReference) return { count: 0 };
      latestAttemptReference = data.providerReference;
      return { count: 1 };
    }) },
    wallet: { update: jest.fn() },
    financialLedgerEntry: { create: jest.fn() },
    financialAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const processing = { ...withdrawal, status: 'PROCESSING', provider: withdrawal.provider ?? withdrawal.payoutAccount.provider, providerReference: 'lj_wd_withdrawal-1', payout: { id: 'payout-1', amount: withdrawal.payoutAmount } };
  tx.withdrawal.findUnique.mockResolvedValueOnce(withdrawal).mockResolvedValueOnce(processing);
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: withdrawal.amount, availableBalance: new Prisma.Decimal('20000.00') }]);
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    status: withdrawal.status,
    provider: withdrawal.provider,
    currency: withdrawal.currency,
    payoutAccount: withdrawal.payoutAccount,
  });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
  mockPrisma.payoutAttempt.update.mockImplementation(async ({ data }) => {
    if (data.providerReference !== undefined) latestAttemptReference = data.providerReference;
    return {};
  });
  mockPrisma.payoutAttempt.updateMany.mockImplementation(async ({ where, data }) => {
    const requestedReference = where.OR?.[1]?.providerReference;
    if (latestAttemptReference !== null && latestAttemptReference !== requestedReference) return { count: 0 };
    latestAttemptReference = data.providerReference;
    return { count: 1 };
  });
  tx.setAttemptReference = (reference) => { latestAttemptReference = reference; };
  return tx;
};

const setupFlutterwaveRecovery = ({ transfer, attemptReference = null } = {}) => {
  const attempt = { id: 'attempt-recovery', providerReference: attemptReference, status: 'PROCESSING' };
  const withdrawal = {
    id: withdrawalId,
    seekerId: 'seeker-1',
    status: 'PROCESSING',
    provider: 'FLUTTERWAVE',
    providerReference: 'lj_wd_withdrawal-1',
    currency: 'USD',
    payout: {
      id: 'payout-recovery',
      amount: new Prisma.Decimal('1000.00'),
      recipientUserId: 'seeker-1',
      attempts: [attempt],
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(withdrawal),
    },
    payoutAttempt: {
      findFirst: jest.fn().mockResolvedValue(attempt),
      updateMany: jest.fn().mockImplementation(async ({ data }) => {
        attempt.providerReference = data.providerReference;
        return { count: 1 };
      }),
    },
    financialAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  mockPrisma.withdrawal.findUnique.mockResolvedValue(withdrawal);
  flutterwave.getFlutterwaveTransferById.mockResolvedValue(transfer);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
  return { tx, withdrawal, attempt };
};

const usUsdWithdrawal = (overrides = {}) => ({
  ...baseWithdrawal,
  amount: new Prisma.Decimal('1000.00'),
  payoutAmount: new Prisma.Decimal('1000.00'),
  currency: 'USD',
  status: 'PENDING',
  provider: 'FLUTTERWAVE',
  encryptedAccountNumberSnapshot: 'snapshot-us-account',
  encryptedTransferMetadataSnapshot: 'encrypted-transfer-metadata',
  payoutMethodSnapshot: 'BANK_ACCOUNT',
  payoutCountrySnapshot: 'United States',
  bankCodeSnapshot: null,
  bankNameSnapshot: 'BANK OF AMERICA, N.A.',
  accountNameSnapshot: 'Jane Doe',
  payoutAccount: {
    ...baseWithdrawal.payoutAccount,
    provider: 'FLUTTERWAVE',
    country: 'United States',
    currency: 'USD',
    bankCode: '999',
    encryptedAccountNumber: 'changed-account',
    encryptedPayoutMetadata: 'changed-metadata',
    verifiedAt: null,
  },
  ...overrides,
});

const setupFlutterwaveOutcome = ({ transfer, attemptReference }) => {
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'wallet-1', pendingWithdrawalBalance: new Prisma.Decimal('1000.00'), availableBalance: new Prisma.Decimal('0.00') }]),
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue({
        id: withdrawalId,
        walletId: 'wallet-1',
        amount: new Prisma.Decimal('1000.00'),
        withdrawalFeeAmount: new Prisma.Decimal('0.00'),
        currency: 'USD',
        status: 'PROCESSING',
        provider: 'FLUTTERWAVE',
        providerReference: 'lj_wd_withdrawal-1',
        payout: { id: 'payout-1', amount: new Prisma.Decimal('1000.00') },
      }),
      update: jest.fn(),
    },
    payoutAttempt: {
      findFirst: jest.fn().mockResolvedValue({ id: 'attempt-1', providerReference: attemptReference }),
      update: jest.fn(),
    },
    payout: { update: jest.fn() },
    wallet: { update: jest.fn() },
    financialLedgerEntry: { create: jest.fn() },
  };
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    status: 'PROCESSING',
    provider: 'FLUTTERWAVE',
    providerReference: 'lj_wd_withdrawal-1',
    payout: { attempts: [{ providerReference: attemptReference }] },
  });
  flutterwave.getFlutterwaveTransferById.mockResolvedValue(transfer);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
  return tx;
};

beforeEach(() => {
  jest.clearAllMocks();
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = true;
  env.LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED = true;
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = false;
  paystack.createPaystackTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_test' });
  paystack.createPaystackTransfer.mockResolvedValue({ transfer_code: 'TRF_test', reference: 'lj_wd_withdrawal-1', status: 'success', amount: 8000000, currency: 'NGN' });
  flutterwave.createFlutterwaveTransfer.mockResolvedValue({ id: 12345, reference: 'lj_wd_withdrawal-1', status: 'SUCCESSFUL', amount: 80000, currency: 'NGN' });
  flutterwave.getFlutterwaveTransferById.mockResolvedValue(null);
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

test('disabled withdrawal feature blocks pending transfer execution before creating a payout', async () => {
  setupTransaction();
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = false;

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });

  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransferRecipient).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('worker does not claim pending withdrawals while execution is disabled', async () => {
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = false;

  await expect(executePendingWithdrawals()).resolves.toEqual([]);

  expect(mockPrisma.withdrawal.findMany).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('provider reconciliation remains available while new transfer execution is disabled', async () => {
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = false;
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    status: 'PROCESSING',
    provider: 'PAYSTACK',
    providerReference: 'lj_wd_withdrawal-1',
    payout: { attempts: [{ providerReference: 'TRF_test' }] },
  });
  paystack.getPaystackTransferByCode.mockResolvedValue(null);

  await expect(reconcileWithdrawal(withdrawalId)).resolves.toEqual({ status: 'PROCESSING', unresolved: true });

  expect(paystack.getPaystackTransferByCode).toHaveBeenCalledWith('TRF_test');
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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

test('payout execution uses the immutable destination snapshot instead of changed account details', async () => {
  const snapshottedWithdrawal = {
    ...baseWithdrawal,
    provider: 'FLUTTERWAVE',
    payoutMethodSnapshot: 'BANK_ACCOUNT',
    payoutCountrySnapshot: 'Nigeria',
    bankCodeSnapshot: '044',
    bankNameSnapshot: 'Snapshot Bank',
    accountNameSnapshot: 'Original Beneficiary',
    encryptedAccountNumberSnapshot: 'snapshot-encrypted-identifier',
    accountNumberLast4Snapshot: '7890',
    payoutAccountVerifiedAtSnapshot: new Date(),
    payoutAccount: {
      ...baseWithdrawal.payoutAccount,
      provider: 'PAYSTACK',
      bankCode: '058',
      bankName: 'Updated Bank',
      accountName: 'Updated Beneficiary',
      encryptedAccountNumber: 'updated-encrypted-identifier',
    },
  };
  const tx = setupTransaction({ withdrawal: snapshottedWithdrawal });

  await executeWithdrawal(withdrawalId);

  expect(decryptPayoutIdentifier).toHaveBeenCalledWith('snapshot-encrypted-identifier');
  expect(flutterwave.createFlutterwaveTransfer).toHaveBeenCalledWith(expect.objectContaining({
    bankCode: '044',
    beneficiaryName: 'Original Beneficiary',
  }));
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
});

test('does not execute a US/USD withdrawal when no approved settlement route is available', async () => {
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
  setupTransaction({ withdrawal: usWithdrawal });

  await expect(executeWithdrawal(withdrawalId)).rejects.toThrow(/approved beneficiary verification and settlement route/i);

  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('USD execution remains blocked even when a USD feature flag is enabled without an approved route', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const usWithdrawal = usUsdWithdrawal({
    accountNumberLast4Snapshot: '1872',
    payoutAccount: {
      ...usUsdWithdrawal().payoutAccount,
      bankName: 'Changed Bank',
      accountName: 'Changed Name',
    },
  });
  setupTransaction({ withdrawal: usWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockResolvedValue({
    id: 9234,
    reference: 'lj_wd_withdrawal-1',
    status: 'NEW',
    amount: 1000,
    currency: 'USD',
  });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });
  expect(decryptPayoutIdentifier).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
});

test('does not execute USD withdrawal without a verified route, regardless of account-number snapshot', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const tx = setupTransaction({ withdrawal: usUsdWithdrawal({ encryptedAccountNumberSnapshot: null }) });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });

  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(decryptPayoutIdentifier).not.toHaveBeenCalledWith('changed-account');
  expect(tx.payout.create).not.toHaveBeenCalled();
  expect(tx.payoutAttempt.create).not.toHaveBeenCalled();
  expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('does not execute USD withdrawal without a verified route, regardless of metadata snapshot', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const tx = setupTransaction({ withdrawal: usUsdWithdrawal({ encryptedTransferMetadataSnapshot: null }) });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });

  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(decryptPayoutIdentifier).not.toHaveBeenCalledWith('changed-metadata');
  expect(tx.payout.create).not.toHaveBeenCalled();
  expect(tx.payoutAttempt.create).not.toHaveBeenCalled();
  expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('USD transfer execution fails closed before decryption while no route is approved', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const tx = setupTransaction({ withdrawal: usUsdWithdrawal() });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });

  expect(decryptPayoutIdentifier).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(paystack.createPaystackTransfer).not.toHaveBeenCalled();
  expect(tx.payout.create).not.toHaveBeenCalled();
  expect(tx.payoutAttempt.create).not.toHaveBeenCalled();
  expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('worker does not claim an unapproved USD withdrawal', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  setupTransaction({ withdrawal: usUsdWithdrawal() });
  mockPrisma.withdrawal.findMany.mockResolvedValue([]);

  await expect(executePendingWithdrawals()).resolves.toEqual([]);

  expect(mockPrisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: 'PENDING', currency: 'NGN' },
  }));
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('USD metadata is not decrypted or submitted while no route is approved', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const tx = setupTransaction({ withdrawal: usUsdWithdrawal() });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });

  expect(decryptPayoutIdentifier).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(tx.payout.create).not.toHaveBeenCalled();
  expect(tx.payoutAttempt.create).not.toHaveBeenCalled();
  expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('a USD withdrawal is not submitted while its settlement route is unavailable', async () => {
  env.LEAMJOBS_FREELANCE_USD_WITHDRAWALS_ENABLED = true;
  const usWithdrawal = {
    ...baseWithdrawal,
    amount: new Prisma.Decimal('1000.00'),
    payoutAmount: new Prisma.Decimal('1000.00'),
    currency: 'USD',
    provider: 'FLUTTERWAVE',
    encryptedAccountNumberSnapshot: 'snapshot-us-account',
    encryptedTransferMetadataSnapshot: 'encrypted-transfer-metadata',
    payoutMethodSnapshot: 'BANK_ACCOUNT',
    payoutCountrySnapshot: 'United States',
    bankNameSnapshot: 'BANK OF AMERICA, N.A.',
    accountNameSnapshot: 'Jane Doe',
    payoutAccount: {
      ...baseWithdrawal.payoutAccount,
      provider: 'FLUTTERWAVE',
      country: 'United States',
      currency: 'USD',
      bankCode: null,
      verifiedAt: null,
    },
  };
  setupTransaction({ withdrawal: usWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockRejectedValue(Object.assign(new Error('timeout'), {
    name: 'FlutterwaveRequestError',
    outcomeUnknown: true,
    status: 502,
  }));

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 503 });
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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

test('execution cannot replace a concurrently associated transfer or finalize the conflicting result', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockImplementation(async () => {
    tx.setAttemptReference('12345');
    return {
      id: 98765,
      reference: 'lj_wd_withdrawal-1',
      status: 'SUCCESSFUL',
      amount: 80000,
      currency: 'NGN',
    };
  });

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({
    status: 'PROCESSING',
    unresolved: true,
    manualReviewRequired: true,
    message: expect.stringContaining('conflicting provider transfer ID'),
  });

  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'attempt-1',
      OR: [{ providerReference: null }, { providerReference: '98765' }],
    },
    data: { failureReason: null, providerReference: '98765' },
  });
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.withdrawal.update).not.toHaveBeenCalled();
  expect(tx.payout.update).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'SUCCESSFUL' }),
  }));
  expect(tx.payout.update).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('execution can associate a verified transfer ID when no association exists', async () => {
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

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({ status: 'SUCCESSFUL' });

  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'attempt-1',
      OR: [{ providerReference: null }, { providerReference: '12345' }],
    },
    data: { failureReason: null, providerReference: '12345' },
  });
});

test('execution accepts an already associated matching transfer ID', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockImplementation(async () => {
    tx.setAttemptReference('12345');
    return {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'SUCCESSFUL',
      amount: 80000,
      currency: 'NGN',
    };
  });

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({ status: 'SUCCESSFUL' });
  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledTimes(1);
});

test('definitive Flutterwave pre-submission rejection releases reservation without storing a merchant reference as transfer ID', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockRejectedValue(Object.assign(new Error('rejected'), {
    name: 'FlutterwaveRequestError',
    outcomeUnknown: false,
    status: 422,
  }));

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({ status: 'FAILED' });

  expect(tx.wallet.update).toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_FAILED_REVERSAL' }),
  }));
  expect(tx.payoutAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'attempt-1' },
    data: expect.not.objectContaining({ providerReference: 'lj_wd_withdrawal-1' }),
  }));
  expect(mockPrisma.payoutAttempt.updateMany).not.toHaveBeenCalled();
});

test('a pre-submission rejection cannot release a reservation after a transfer was associated', async () => {
  const flwWithdrawal = {
    ...baseWithdrawal,
    provider: null,
    payoutAccount: { ...baseWithdrawal.payoutAccount, provider: 'FLUTTERWAVE' },
  };
  const tx = setupTransaction({ withdrawal: flwWithdrawal });
  flutterwave.createFlutterwaveTransfer.mockImplementation(async () => {
    tx.setAttemptReference('12345');
    throw Object.assign(new Error('rejected'), {
      name: 'FlutterwaveRequestError',
      outcomeUnknown: false,
      status: 422,
    });
  });

  await expect(executeWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 409 });

  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
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

  await expect(executeWithdrawal(withdrawalId)).resolves.toMatchObject({
    status: 'PROCESSING',
    unresolved: true,
    manualReviewRequired: true,
    message: expect.stringContaining('do not submit another payout'),
  });
  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).toHaveBeenCalledTimes(1);
  expect(mockPrisma.payoutAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PROCESSING' }),
  }));
});

test('Flutterwave reconciliation without a transfer ID remains visible for manual review', async () => {
  setupTransaction();
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    status: 'PROCESSING',
    provider: 'FLUTTERWAVE',
    providerReference: 'lj_wd_withdrawal-1',
    payout: { attempts: [{ providerReference: null, failureReason: 'Flutterwave transfer ID was not recorded.' }] },
  });

  await expect(reconcileWithdrawal(withdrawalId)).resolves.toMatchObject({
    status: 'PROCESSING',
    unresolved: true,
    manualReviewRequired: true,
    message: 'Flutterwave transfer ID was not recorded.',
  });
  expect(flutterwave.getFlutterwaveTransferById).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('admin recovery associates only a provider-verified original transfer and audits the actor', async () => {
  const verifiedTransfer = {
    id: 12345,
    reference: 'lj_wd_withdrawal-1',
    status: 'NEW',
    amount: 1000,
    currency: 'USD',
  };
  const { tx } = setupFlutterwaveRecovery({ transfer: verifiedTransfer });

  await expect(recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1')).resolves.toEqual({
    status: 'PROCESSING',
    unresolved: true,
    transferAssociated: true,
  });

  expect(flutterwave.getFlutterwaveTransferById).toHaveBeenCalledWith('12345');
  expect(tx.payoutAttempt.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'attempt-recovery',
      status: 'PROCESSING',
      OR: [{ providerReference: null }, { providerReference: '12345' }],
    },
    data: { providerReference: '12345' },
  });
  expect(tx.financialAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      actorUserId: 'admin-1',
      entityType: 'WITHDRAWAL',
      entityId: withdrawalId,
      action: 'VERIFIED',
      amount: new Prisma.Decimal('1000.00'),
      currency: 'USD',
      metadata: expect.objectContaining({
        transferId: '12345',
        verification: 'Flutterwave transfer lookup',
      }),
    }),
  }));
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('repeated recovery of the same verified transfer is safe and idempotent', async () => {
  setupFlutterwaveRecovery({
    transfer: {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'NEW',
      amount: 1000,
      currency: 'USD',
    },
  });

  await recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1');
  await expect(recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1')).resolves.toMatchObject({
    status: 'PROCESSING',
    transferAssociated: true,
  });

  expect(flutterwave.getFlutterwaveTransferById).toHaveBeenCalledTimes(2);
});

test.each([
  ['reference', { reference: 'lj_wd_other' }],
  ['amount', { amount: 1001 }],
  ['currency', { currency: 'NGN' }],
])('admin recovery rejects a provider-verified transfer with mismatched %s', async (_label, mismatch) => {
  setupFlutterwaveRecovery({
    transfer: {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'SUCCESSFUL',
      amount: 1000,
      currency: 'USD',
      ...mismatch,
    },
  });

  await expect(recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1')).rejects.toMatchObject({ status: 409 });

  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('admin recovery with no provider result leaves the withdrawal unresolved and unchanged', async () => {
  setupFlutterwaveRecovery({ transfer: null });

  await expect(recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1')).rejects.toMatchObject({ status: 404 });

  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(flutterwave.createFlutterwaveTransfer).not.toHaveBeenCalled();
});

test('admin recovery rejects a payout whose recipient does not own the withdrawal', async () => {
  const { withdrawal } = setupFlutterwaveRecovery({
    transfer: {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'NEW',
      amount: 1000,
      currency: 'USD',
    },
  });
  withdrawal.payout.recipientUserId = 'another-seeker';

  await expect(recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1')).rejects.toMatchObject({ status: 409 });

  expect(flutterwave.getFlutterwaveTransferById).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('duplicate admin recovery cannot associate a second transfer', async () => {
  setupFlutterwaveRecovery({
    transfer: {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'NEW',
      amount: 1000,
      currency: 'USD',
    },
  });
  await recoverFlutterwaveTransfer(withdrawalId, '12345', 'admin-1');
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: withdrawalId,
    seekerId: 'seeker-1',
    status: 'PROCESSING',
    provider: 'FLUTTERWAVE',
    providerReference: 'lj_wd_withdrawal-1',
    currency: 'USD',
    payout: {
      id: 'payout-recovery',
      amount: new Prisma.Decimal('1000.00'),
      recipientUserId: 'seeker-1',
      attempts: [{ id: 'attempt-recovery', providerReference: '12345', status: 'PROCESSING' }],
    },
  });

  await expect(recoverFlutterwaveTransfer(withdrawalId, '98765', 'admin-1')).rejects.toMatchObject({ status: 409 });

  expect(flutterwave.getFlutterwaveTransferById).toHaveBeenCalledTimes(1);
});

test('a conflicting Flutterwave outcome cannot finalize or mutate reserved funds', async () => {
  const tx = setupFlutterwaveOutcome({
    attemptReference: '12345',
    transfer: {
      id: 98765,
      reference: 'lj_wd_withdrawal-1',
      status: 'SUCCESSFUL',
      amount: 1000,
      currency: 'USD',
    },
  });

  await expect(reconcileWithdrawal(withdrawalId)).rejects.toMatchObject({ status: 409 });

  expect(tx.wallet.update).not.toHaveBeenCalled();
  expect(tx.withdrawal.update).not.toHaveBeenCalled();
  expect(tx.payout.update).not.toHaveBeenCalled();
  expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('a matching Flutterwave transfer ID follows the existing success outcome path', async () => {
  const tx = setupFlutterwaveOutcome({
    attemptReference: '12345',
    transfer: {
      id: 12345,
      reference: 'lj_wd_withdrawal-1',
      status: 'SUCCESSFUL',
      amount: 1000,
      currency: 'USD',
    },
  });

  await expect(reconcileWithdrawal(withdrawalId)).resolves.toEqual({ status: 'SUCCESSFUL' });

  expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ pendingWithdrawalBalance: { decrement: new Prisma.Decimal('1000.00') } }),
  }));
  expect(tx.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ entryType: 'WITHDRAWAL_SUCCESSFUL', idempotencyKey: `${withdrawalId}:successful` }),
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
