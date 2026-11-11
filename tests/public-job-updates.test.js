import crypto from 'node:crypto';
import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'public-updates-secret';
process.env.FRONTEND_URL = 'https://leamjobs.com';

const mockPrisma = {
  publicJobSubscriber: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};
const queueEmail = jest.fn().mockResolvedValue({ id: 'delivery-1' });
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/email.service.js', () => ({ EMAIL_TYPES: { JOB_UPDATES_SUBSCRIBED: 'JOB_UPDATES_SUBSCRIBED' }, queueEmail }));

const {
  confirmJobUpdatesSubscription,
  subscribeToJobUpdates,
  unsubscribeFromJobUpdates,
  InvalidJobUpdateConfirmationError,
  InvalidJobUpdateUnsubscribeError,
} = await import('../src/services/publicJobUpdates.service.js');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const encodeId = (id) => Buffer.from(id).toString('base64url');
const response = { message: 'If confirmation is needed, check the inbox for a message from LeamJobs.' };

afterEach(() => {
  jest.resetAllMocks();
  queueEmail.mockResolvedValue({ id: 'delivery-1' });
});

test('creates a pending subscriber and emails a mailbox confirmation link', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue(null);
  mockPrisma.publicJobSubscriber.create.mockImplementation(async ({ data }) => ({
    id: 'subscriber-1',
    email: data.email,
    isSubscribed: false,
    updatedAt: new Date(),
    unsubscribeHash: data.unsubscribeHash,
  }));

  await expect(subscribeToJobUpdates(' Visitor@Example.com ')).resolves.toEqual(response);
  expect(mockPrisma.publicJobSubscriber.create).toHaveBeenCalledWith({
    data: { email: 'visitor@example.com', unsubscribeHash: expect.any(String), isSubscribed: false },
  });
  const [delivery] = queueEmail.mock.calls[0];
  const confirmationUrl = new URL(delivery.context.link);
  const confirmationToken = confirmationUrl.searchParams.get('token').split('.')[1];
  const subscriberHash = mockPrisma.publicJobSubscriber.create.mock.calls[0][0].data.unsubscribeHash;
  expect(delivery).toMatchObject({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    context: { isMarketing: false, linkLabel: 'Confirm subscription' },
  });
  expect(confirmationUrl.pathname).toBe('/unsubscribe-job-updates');
  expect(confirmationUrl.searchParams.get('action')).toBe('confirm');
  expect(confirmationUrl.searchParams.get('token')).toMatch(/^c3Vic2NyaWJlci0x\.[0-9a-f]{64}$/);
  expect(subscriberHash).toBe(hash(confirmationToken));
  expect(subscriberHash).not.toBe(confirmationToken);
});

test('does not reactivate an active subscriber or send duplicate confirmation mail', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    email: 'visitor@example.com',
    isSubscribed: true,
  });

  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual(response);
  expect(mockPrisma.publicJobSubscriber.create).not.toHaveBeenCalled();
  expect(mockPrisma.publicJobSubscriber.updateMany).not.toHaveBeenCalled();
  expect(queueEmail).not.toHaveBeenCalled();
});

test('keeps an opted-out address unsubscribed until its confirmation token is used', async () => {
  const updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  mockPrisma.publicJobSubscriber.findUnique
    .mockResolvedValueOnce({ id: 'subscriber-1', isSubscribed: false, unsubscribedAt: new Date(), updatedAt })
    .mockResolvedValueOnce({ id: 'subscriber-1', email: 'visitor@example.com', isSubscribed: false, updatedAt: new Date() });
  mockPrisma.publicJobSubscriber.updateMany.mockResolvedValue({ count: 1 });

  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual(response);
  expect(mockPrisma.publicJobSubscriber.updateMany).toHaveBeenCalledWith({
    where: { id: 'subscriber-1', isSubscribed: false, updatedAt },
    data: { unsubscribeHash: expect.any(String), unsubscribedAt: null },
  });
  expect(queueEmail).toHaveBeenCalledTimes(1);
});

test('does not rotate tokens or resend confirmation while a request is pending', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    isSubscribed: false,
    unsubscribedAt: null,
    updatedAt: new Date(),
  });

  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual(response);
  expect(mockPrisma.publicJobSubscriber.updateMany).not.toHaveBeenCalled();
  expect(queueEmail).not.toHaveBeenCalled();
});

test('confirms mailbox ownership once using a current, matching token', async () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    isSubscribed: false,
    unsubscribeHash: hash(rawToken),
    updatedAt: new Date(),
  });
  mockPrisma.publicJobSubscriber.updateMany.mockResolvedValue({ count: 1 });

  await expect(confirmJobUpdatesSubscription(`${encodeId('subscriber-1')}.${rawToken}`)).resolves.toEqual({
    message: 'Your email address is confirmed for LeamJobs job updates.',
  });
  expect(mockPrisma.publicJobSubscriber.updateMany).toHaveBeenCalledWith({
    where: { id: 'subscriber-1', isSubscribed: false, unsubscribeHash: hash(rawToken) },
    data: {
      isSubscribed: true,
      subscribedAt: expect.any(Date),
      unsubscribedAt: null,
      unsubscribeHash: expect.any(String),
    },
  });
});

test('rejects expired, malformed, and replayed confirmation tokens', async () => {
  const rawToken = 'valid-token';
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    isSubscribed: false,
    unsubscribeHash: hash(rawToken),
    updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });
  await expect(confirmJobUpdatesSubscription(`${encodeId('subscriber-1')}.${rawToken}`)).rejects.toBeInstanceOf(InvalidJobUpdateConfirmationError);
  await expect(confirmJobUpdatesSubscription('not-a-token')).rejects.toBeInstanceOf(InvalidJobUpdateConfirmationError);
  expect(mockPrisma.publicJobSubscriber.updateMany).not.toHaveBeenCalled();

  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    isSubscribed: true,
    unsubscribeHash: hash(rawToken),
    updatedAt: new Date(),
  });
  await expect(confirmJobUpdatesSubscription(`${encodeId('subscriber-1')}.${rawToken}`)).rejects.toBeInstanceOf(InvalidJobUpdateConfirmationError);
});

test('handles concurrent new submissions without activating or duplicating the address', async () => {
  mockPrisma.publicJobSubscriber.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'subscriber-1', isSubscribed: true });
  mockPrisma.publicJobSubscriber.create.mockRejectedValue({ code: 'P2002' });

  await expect(subscribeToJobUpdates('visitor@example.com')).resolves.toEqual(response);
  expect(mockPrisma.publicJobSubscriber.updateMany).not.toHaveBeenCalled();
  expect(queueEmail).not.toHaveBeenCalled();
});

test('does not report a successful request if persistence fails', async () => {
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue(null);
  mockPrisma.publicJobSubscriber.create.mockRejectedValue(new Error('database unavailable'));
  await expect(subscribeToJobUpdates('visitor@example.com')).rejects.toThrow('database unavailable');
  expect(queueEmail).not.toHaveBeenCalled();
});

test('unsubscribes with a valid token and rejects invalid or stale tokens', async () => {
  const rawToken = 'opaque-token';
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    email: 'visitor@example.com',
    unsubscribeHash: hash(rawToken),
    isSubscribed: true,
  });
  mockPrisma.publicJobSubscriber.updateMany.mockResolvedValue({ count: 1 });

  const token = `${encodeId('subscriber-1')}.${rawToken}`;
  await expect(unsubscribeFromJobUpdates(token)).resolves.toEqual({ message: 'Job update emails have been turned off.' });
  expect(mockPrisma.publicJobSubscriber.updateMany).toHaveBeenCalledWith({
    where: { id: 'subscriber-1', unsubscribeHash: hash(rawToken), isSubscribed: true },
    data: { isSubscribed: false, unsubscribedAt: expect.any(Date) },
  });

  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    email: 'visitor@example.com',
    unsubscribeHash: hash(rawToken),
    isSubscribed: true,
  });
  await expect(unsubscribeFromJobUpdates(`${encodeId('subscriber-1')}.wrong-token`)).rejects.toBeInstanceOf(InvalidJobUpdateUnsubscribeError);
});

test('rejects predictable email-derived legacy unsubscribe tokens without changing subscription state', async () => {
  const email = 'visitor@example.com';
  const predictableToken = hash(`job-updates:${email}`);
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    id: 'subscriber-1',
    email,
    isSubscribed: true,
    unsubscribeHash: predictableToken,
  });

  await expect(unsubscribeFromJobUpdates(`${encodeId('subscriber-1')}.${predictableToken}`))
    .rejects.toBeInstanceOf(InvalidJobUpdateUnsubscribeError);
  expect(mockPrisma.publicJobSubscriber.updateMany).not.toHaveBeenCalled();
});

test('accepts a current random stored unsubscribe token and makes repeat requests idempotent', async () => {
  const randomToken = crypto.randomBytes(32).toString('hex');
  const storedHash = hash(randomToken);
  mockPrisma.publicJobSubscriber.findUnique
    .mockResolvedValueOnce({ id: 'subscriber-1', email: 'visitor@example.com', isSubscribed: true, unsubscribeHash: storedHash })
    .mockResolvedValueOnce({ id: 'subscriber-1', email: 'visitor@example.com', isSubscribed: false, unsubscribeHash: storedHash });
  mockPrisma.publicJobSubscriber.updateMany.mockResolvedValue({ count: 1 });

  await expect(unsubscribeFromJobUpdates(`${encodeId('subscriber-1')}.${storedHash}`))
    .resolves.toEqual({ message: 'Job update emails have been turned off.' });
  await expect(unsubscribeFromJobUpdates(`${encodeId('subscriber-1')}.${storedHash}`))
    .resolves.toEqual({ message: 'Job update emails have been turned off.' });
  expect(mockPrisma.publicJobSubscriber.updateMany).toHaveBeenCalledTimes(1);
});
