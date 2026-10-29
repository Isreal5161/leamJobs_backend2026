import crypto from 'node:crypto';
import { jest } from '@jest/globals';

const reference = 'lj_wd_withdrawal-1';
const payload = {
  id: 'event-1',
  event: 'transfer.completed',
  data: { id: 12345, reference, status: 'SUCCESSFUL', amount: 80000, currency: 'NGN' },
};
const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const mockPrisma = {
  withdrawal: { findUnique: jest.fn() },
  payment: { findUnique: jest.fn() },
  payoutAttempt: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  providerWebhookEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const reconcileWithdrawal = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/contractPayment.service.js', () => ({
  handleFlutterwaveWebhook: jest.fn(),
}));
jest.unstable_mockModule('../src/services/seekerSubscription.service.js', () => ({
  verifySeekerSubscriptionPayment: jest.fn(),
}));
jest.unstable_mockModule('../src/services/withdrawalExecution.service.js', () => ({
  reconcileWithdrawal,
}));

const { handleFlutterwaveWebhook } = await import('../src/services/flutterwaveWebhook.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.withdrawal.findUnique.mockResolvedValue({
    id: 'withdrawal-1',
    provider: 'FLUTTERWAVE',
    status: 'PROCESSING',
    providerReference: reference,
    currency: 'NGN',
    payout: { id: 'payout-1', amount: 80000 },
  });
  mockPrisma.payoutAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', providerReference: null });
  mockPrisma.payoutAttempt.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.providerWebhookEvent.create.mockResolvedValue({});
  mockPrisma.providerWebhookEvent.update.mockResolvedValue({});
  reconcileWithdrawal.mockResolvedValue({ status: 'SUCCESSFUL' });
});

test('binds transfer webhook ID to the attempt and reconciles with Flutterwave', async () => {
  await expect(handleFlutterwaveWebhook({ payload })).resolves.toEqual({
    duplicate: false,
    withdrawalId: 'withdrawal-1',
    status: 'SUCCESSFUL',
  });

  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'attempt-1',
      OR: [{ providerReference: null }, { providerReference: '12345' }],
    },
    data: { providerReference: '12345' },
  });
  expect(reconcileWithdrawal).toHaveBeenCalledWith('withdrawal-1');
  expect(mockPrisma.providerWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { processedAt: expect.any(Date) },
  }));
});

test('does not reconcile an already processed duplicate webhook event', async () => {
  mockPrisma.providerWebhookEvent.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
  mockPrisma.providerWebhookEvent.findUnique.mockResolvedValue({ payloadHash: eventHash, processedAt: new Date() });

  await expect(handleFlutterwaveWebhook({ payload })).resolves.toEqual({ duplicate: true });
  expect(reconcileWithdrawal).not.toHaveBeenCalled();
  expect(mockPrisma.payoutAttempt.updateMany).not.toHaveBeenCalled();
});

test.each([
  ['amount', { amount: 80001 }],
  ['currency', { currency: 'USD' }],
  ['reference', { reference: 'lj_wd_another-withdrawal', tx_ref: reference }],
])('rejects a withdrawal webhook with mismatched %s before recording or reconciling it', async (_label, fields) => {
  const invalidPayload = { ...payload, data: { ...payload.data, ...fields } };

  await expect(handleFlutterwaveWebhook({ payload: invalidPayload })).rejects.toMatchObject({ status: 409 });

  expect(mockPrisma.providerWebhookEvent.create).not.toHaveBeenCalled();
  expect(mockPrisma.payoutAttempt.updateMany).not.toHaveBeenCalled();
  expect(reconcileWithdrawal).not.toHaveBeenCalled();
});

test('a concurrent recovery association of transfer A blocks a webhook carrying transfer B', async () => {
  const transferBPayload = {
    ...payload,
    data: { ...payload.data, id: 98765 },
  };
  mockPrisma.payoutAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', providerReference: null });
  // The recovery transaction has won the conditional update after this webhook's read.
  mockPrisma.payoutAttempt.updateMany.mockResolvedValue({ count: 0 });

  await expect(handleFlutterwaveWebhook({ payload: transferBPayload })).rejects.toMatchObject({ status: 409 });

  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'attempt-1',
      OR: [{ providerReference: null }, { providerReference: '98765' }],
    },
    data: { providerReference: '98765' },
  });
  expect(reconcileWithdrawal).not.toHaveBeenCalled();
  expect(mockPrisma.providerWebhookEvent.update).not.toHaveBeenCalled();
});

test('a webhook cannot replace an already associated different transfer ID', async () => {
  mockPrisma.payoutAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', providerReference: '98765' });

  await expect(handleFlutterwaveWebhook({ payload })).rejects.toMatchObject({ status: 409 });

  expect(mockPrisma.payoutAttempt.updateMany).not.toHaveBeenCalled();
  expect(reconcileWithdrawal).not.toHaveBeenCalled();
});

test('a webhook for the already associated transfer remains idempotently reconcilable', async () => {
  mockPrisma.payoutAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', providerReference: '12345' });

  await expect(handleFlutterwaveWebhook({ payload })).resolves.toMatchObject({
    duplicate: false,
    withdrawalId: 'withdrawal-1',
  });

  expect(mockPrisma.payoutAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { providerReference: '12345' },
  }));
  expect(reconcileWithdrawal).toHaveBeenCalledWith('withdrawal-1');
});
