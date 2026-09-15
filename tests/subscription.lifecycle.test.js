import { jest } from '@jest/globals';

const mockPrisma = {
  $transaction: jest.fn(),
  subscription: { findMany: jest.fn() },
  notification: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const {
  addBillingInterval,
  expireSubscriptionBatch,
  expireSubscriptions,
} = await import('../src/services/subscriptionLifecycle.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscription.findMany.mockResolvedValue([]);
  mockPrisma.notification.findFirst.mockResolvedValue(null);
  mockPrisma.notification.findUnique.mockResolvedValue(null);
  mockPrisma.notification.create.mockResolvedValue({
    id: 'note-1',
    recipientUserId: 'user-1',
    actorUserId: null,
    type: 'WARNING',
    category: 'SUBSCRIPTION',
    eventKey: 'subscription:expiry-reminder:sub-1:3d',
    title: 'Subscription expires soon',
    message: 'Your subscription expires in 3 days.',
    link: '/seeker/payments',
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    actor: null,
  });
});

test.each([
  ['2026-01-15T12:00:00.000Z', '2026-02-15T12:00:00.000Z'],
  ['2026-01-31T12:00:00.000Z', '2026-02-28T12:00:00.000Z'],
  ['2028-01-31T12:00:00.000Z', '2028-02-29T12:00:00.000Z'],
])('adds one calendar month from %s to %s', (start, expected) => {
  expect(addBillingInterval(new Date(start), 'MONTHLY').toISOString()).toBe(expected);
});

test('expires transitioned subscriptions and records one EXPIRED event in the transaction', async () => {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'sub-1', userId: 'user-1' }]),
    subscriptionEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

  const expired = await expireSubscriptionBatch({ client: mockPrisma, batchSize: 25 });

  expect(expired).toEqual([{ id: 'sub-1', userId: 'user-1' }]);
  expect(transaction.subscriptionEvent.create).toHaveBeenCalledWith({
    data: {
      subscriptionId: 'sub-1',
      eventType: 'EXPIRED',
      metadata: { userId: 'user-1', reason: 'END_DATE_REACHED' },
    },
  });
});

test('repeated expiration attempts create no event after the first transition', async () => {
  const transaction = {
    $queryRaw: jest.fn(),
    subscriptionEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
  };
  transaction.$queryRaw
    .mockResolvedValueOnce([{ id: 'sub-1', userId: 'user-1' }])
    .mockResolvedValueOnce([]);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

  await expireSubscriptionBatch({ client: mockPrisma });
  await expireSubscriptionBatch({ client: mockPrisma });

  expect(transaction.subscriptionEvent.create).toHaveBeenCalledTimes(1);
});

test('scheduled expiration processes bounded batches until the final short batch', async () => {
  const transaction = {
    $queryRaw: jest.fn(),
    subscriptionEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  transaction.$queryRaw
    .mockResolvedValueOnce(Array.from({ length: 2 }, (_, index) => ({ id: `sub-${index}`, userId: 'user-1' })))
    .mockResolvedValueOnce([{ id: 'sub-2', userId: 'user-1' }])
    .mockResolvedValueOnce([]);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

  await expect(expireSubscriptions({ client: mockPrisma, batchSize: 2 })).resolves.toBe(3);
  expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  expect(transaction.subscriptionEvent.create).toHaveBeenCalledTimes(3);
});

test('notifies active subscribers once when they enter the three-day reminder window', async () => {
  mockPrisma.subscription.findMany
    .mockResolvedValueOnce([{ id: 'sub-1', userId: 'user-1', endDate: new Date(), plan: { displayName: 'Pro' } }])
    .mockResolvedValueOnce([]);

  const { notifySubscriptionExpiryReminders } = await import('../src/services/subscriptionLifecycle.service.js');
  await expect(notifySubscriptionExpiryReminders({ client: mockPrisma, batchSize: 10 })).resolves.toBe(1);
  expect(mockPrisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      recipientUserId: 'user-1',
      eventKey: 'subscription:expiry-reminder:sub-1:3d',
      category: 'SUBSCRIPTION',
    }),
  }));
});