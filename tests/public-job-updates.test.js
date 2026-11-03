import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'public-updates-secret';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  publicJobSubscriber: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};
const queueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({ EMAIL_TYPES: { JOB_UPDATES_SUBSCRIBED: 'JOB_UPDATES_SUBSCRIBED' }, queueEmail }));

const { subscribeToJobUpdates, unsubscribeFromJobUpdates, InvalidJobUpdateUnsubscribeError } = await import('../src/services/publicJobUpdates.service.js');

afterEach(() => jest.clearAllMocks());

test('subscribes a public email without creating a user account', async () => {
  mockPrisma.publicJobSubscriber.upsert.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  await expect(subscribeToJobUpdates(' Visitor@Example.com ')).resolves.toEqual({ message: 'You are subscribed to LeamJobs job updates.' });
  expect(mockPrisma.publicJobSubscriber.upsert).toHaveBeenCalledWith({
    where: { email: 'visitor@example.com' },
    create: { email: 'visitor@example.com', unsubscribeHash: expect.any(String) },
    update: { isSubscribed: true, unsubscribedAt: null },
  });
  expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ publicSubscriberId: 'subscriber-1', emailType: 'JOB_UPDATES_SUBSCRIBED', context: expect.objectContaining({ unsubscribeUrl: expect.stringContaining('/unsubscribe-job-updates?token=') }) }));
});

test('handles duplicate active and resubscribed addresses cleanly', async () => {
  const activeSubscriber = { id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true };
  const unsubscribedSubscriber = { ...activeSubscriber, isSubscribed: false, unsubscribedAt: new Date() };
  mockPrisma.publicJobSubscriber.upsert
    .mockResolvedValueOnce(activeSubscriber)
    .mockResolvedValueOnce(activeSubscriber);
  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual({ message: 'You are subscribed to LeamJobs job updates.' });
  expect(mockPrisma.publicJobSubscriber.upsert).toHaveBeenCalledTimes(1);
  mockPrisma.publicJobSubscriber.upsert.mockResolvedValueOnce({ ...unsubscribedSubscriber, isSubscribed: true, unsubscribedAt: null });
  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual({ message: 'You are subscribed to LeamJobs job updates.' });
  expect(mockPrisma.publicJobSubscriber.upsert).toHaveBeenLastCalledWith({
    where: { email: 'visitor@example.com' },
    create: { email: 'visitor@example.com', unsubscribeHash: expect.any(String) },
    update: { isSubscribed: true, unsubscribedAt: null },
  });
});

test('concurrent duplicate submissions upsert one subscriber and use one idempotency key', async () => {
  const subscribers = new Map();
  mockPrisma.publicJobSubscriber.upsert.mockImplementation(async ({ where, create, update }) => {
    const current = subscribers.get(where.email);
    if (current) {
      const resubscribed = { ...current, ...update };
      subscribers.set(where.email, resubscribed);
      return resubscribed;
    }
    const created = { id: 'subscriber-1', ...create, isSubscribed: true };
    subscribers.set(where.email, created);
    return created;
  });

  await Promise.all([
    subscribeToJobUpdates('Visitor@Example.com'),
    subscribeToJobUpdates(' visitor@example.com '),
  ]);

  expect(subscribers.size).toBe(1);
  expect(subscribers.get('visitor@example.com')).toMatchObject({
    email: 'visitor@example.com',
    isSubscribed: true,
  });
  expect(queueEmail).toHaveBeenCalledTimes(2);
  expect(new Set(queueEmail.mock.calls.map(([delivery]) => delivery.eventKey)).size).toBe(1);
});

test('does not report success when subscriber persistence fails', async () => {
  mockPrisma.publicJobSubscriber.upsert.mockRejectedValue(new Error('database unavailable'));
  await expect(subscribeToJobUpdates('visitor@example.com')).rejects.toThrow('database unavailable');
  expect(queueEmail).not.toHaveBeenCalled();
});

test('unsubscribes securely and rejects an invalid token', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  await expect(unsubscribeFromJobUpdates('bad-token')).rejects.toBeInstanceOf(InvalidJobUpdateUnsubscribeError);
});

test('unsubscribes an existing subscriber and keeps the address eligible for later resubscription', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  mockPrisma.publicJobSubscriber.update.mockResolvedValue({ id: 'subscriber-1', isSubscribed: false, unsubscribedAt: new Date() });
  const token = `${Buffer.from('subscriber-1').toString('base64url')}.hash-1`;

  await expect(unsubscribeFromJobUpdates(token)).resolves.toEqual({ message: 'Job update emails have been turned off.' });
  expect(mockPrisma.publicJobSubscriber.update).toHaveBeenCalledWith({
    where: { id: 'subscriber-1' },
    data: { isSubscribed: false, unsubscribedAt: expect.any(Date) },
  });
});
