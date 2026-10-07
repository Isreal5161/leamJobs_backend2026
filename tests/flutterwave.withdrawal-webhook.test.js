import crypto from 'node:crypto';
import { jest } from '@jest/globals';

const reference = 'lj_wd_withdrawal-1';
const payload = {
  id: 'event-1',
  event: 'transfer.completed',
  data: { id: 12345, reference, status: 'SUCCESSFUL' },
};
const eventHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const mockPrisma = {
  withdrawal: { findUnique: jest.fn() },
  payment: { findUnique: jest.fn() },
  payoutAttempt: { findFirst: jest.fn(), update: jest.fn() },
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
    payout: { id: 'payout-1' },
  });
  mockPrisma.payoutAttempt.findFirst.mockResolvedValue({ id: 'attempt-1', providerReference: null });
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

  expect(mockPrisma.payoutAttempt.update).toHaveBeenCalledWith({
    where: { id: 'attempt-1' },
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
  expect(mockPrisma.payoutAttempt.update).not.toHaveBeenCalled();
});
