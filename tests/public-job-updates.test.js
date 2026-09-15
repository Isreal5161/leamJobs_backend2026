import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'public-updates-secret';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  publicJobSubscriber: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
};
const queueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({ EMAIL_TYPES: { JOB_UPDATES_SUBSCRIBED: 'JOB_UPDATES_SUBSCRIBED' }, queueEmail }));

const { subscribeToJobUpdates, unsubscribeFromJobUpdates, InvalidJobUpdateUnsubscribeError } = await import('../src/services/publicJobUpdates.service.js');

afterEach(() => jest.clearAllMocks());

test('subscribes a public email without creating a user account', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue(null);
  mockPrisma.publicJobSubscriber.create.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  await expect(subscribeToJobUpdates(' Visitor@Example.com ')).resolves.toEqual({ message: 'You are subscribed to LeamJobs job updates.' });
  expect(mockPrisma.publicJobSubscriber.create).toHaveBeenCalledWith({ data: { email: 'visitor@example.com', unsubscribeHash: expect.any(String) } });
  expect(queueEmail).toHaveBeenCalledWith(expect.objectContaining({ publicSubscriberId: 'subscriber-1', emailType: 'JOB_UPDATES_SUBSCRIBED', context: expect.objectContaining({ unsubscribeUrl: expect.stringContaining('/unsubscribe-job-updates?token=') }) }));
});

test('handles duplicate active and resubscribed addresses cleanly', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  mockPrisma.publicJobSubscriber.update.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual({ message: 'This email is already subscribed to job updates.' });
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: false });
  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual({ message: 'You are subscribed to LeamJobs job updates.' });
});

test('unsubscribes securely and rejects an invalid token', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({ id: 'subscriber-1', email: 'visitor@example.com', unsubscribeHash: 'hash-1', isSubscribed: true });
  await expect(unsubscribeFromJobUpdates('bad-token')).rejects.toBeInstanceOf(InvalidJobUpdateUnsubscribeError);
});
