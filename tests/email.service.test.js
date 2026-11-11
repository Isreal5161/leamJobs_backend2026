import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'email-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.EMAIL_ENABLED = 'false';
process.env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY = 'job-updates-email-test-key-at-least-32-bytes';

const mockSendMail = jest.fn();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));
const mockPrisma = {
  emailDelivery: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  publicJobSubscriber: { findUnique: jest.fn() },
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));

const { env } = await import('../src/config/env.js');
const {
  isEmailEnabled,
  queueEmail,
  sendEmailDelivery,
  processPendingEmails,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} = await import('../src/services/email.service.js');

afterEach(() => {
  jest.clearAllMocks();
  env.EMAIL_ENABLED = false;
  env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY = process.env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY;
});

test('email stays safely disabled without SMTP credentials', () => {
  expect(isEmailEnabled()).toBe(false);
});

test('queues an idempotent email delivery without storing credentials', async () => {
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-1', status: 'PENDING', attempts: 0, recipientUserId: 'user-1', emailType: 'APPLICATION_SUBMITTED', eventKey: 'application:submitted:1' });
  await queueEmail({ recipientUserId: 'user-1', emailType: 'APPLICATION_SUBMITTED', eventKey: 'application:submitted:1', recipientEmail: 'employer@example.com', context: { title: 'New application', message: 'A seeker applied.' } });
  expect(mockPrisma.emailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientEmail: 'employer@example.com', emailType: 'APPLICATION_SUBMITTED' }) }));
  const data = mockPrisma.emailDelivery.create.mock.calls[0][0].data;
  expect(data.html).toContain('LeamJobs');
  expect(data.text).toContain('A seeker applied.');
  expect(data).not.toHaveProperty('password');
});

test('public subscription confirmation deliveries use the public-subscriber idempotency key', async () => {
  const delivery = {
    id: 'public-confirmation', status: 'PENDING', attempts: 0,
    recipientUserId: null, emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:subscribed:subscriber-1',
  };
  mockPrisma.emailDelivery.create
    .mockResolvedValueOnce(delivery)
    .mockRejectedValueOnce({ code: 'P2002' });
  mockPrisma.emailDelivery.findUnique.mockResolvedValue(delivery);
  const input = {
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:subscribed:subscriber-1',
    recipientEmail: 'visitor@example.com',
    context: { title: 'Subscribed', message: 'Job updates enabled.' },
  };

  await expect(queueEmail(input)).resolves.toEqual(delivery);
  await expect(queueEmail(input)).resolves.toEqual(delivery);

  expect(mockPrisma.emailDelivery.findUnique).toHaveBeenCalledWith({
    where: {
      publicSubscriberId_emailType_eventKey: {
        publicSubscriberId: 'subscriber-1',
        emailType: 'JOB_UPDATES_SUBSCRIBED',
        eventKey: 'public-job-updates:subscribed:subscriber-1',
      },
    },
    select: expect.any(Object),
  });
});

test('delivers mailbox confirmations while the public subscriber is pending', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  mockSendMail.mockResolvedValue({});
  const delivery = {
    id: 'public-confirmation', recipientUserId: null, publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com', emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:hash', status: 'PENDING', attempts: 0,
    publicSubscriber: { isSubscribed: false },
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    email: 'visitor@example.com',
    isSubscribed: false,
  });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(1);
  expect(mockPrisma.publicJobSubscriber.findUnique).toHaveBeenCalledWith({
    where: { id: 'subscriber-1' },
    select: { email: true, isSubscribed: true },
  });
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'visitor@example.com' }));
});

test('encrypts confirmation email content at rest and decrypts it only for delivery', async () => {
  const token = 'private-confirmation-bearer-token';
  const context = {
    title: 'Confirm your LeamJobs job updates',
    message: 'Confirm your email address.',
    link: `https://leamjobs.com/unsubscribe-job-updates?action=confirm&token=${token}`,
    linkLabel: 'Confirm subscription',
    isMarketing: false,
  };
  mockPrisma.emailDelivery.create.mockImplementation(async ({ data }) => ({ id: 'encrypted-confirmation', ...data }));
  const queued = await queueEmail({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:hash',
    recipientEmail: 'visitor@example.com',
    context,
  });
  const durable = mockPrisma.emailDelivery.create.mock.calls[0][0].data;

  expect(durable.html).toContain('leamjobs:job-updates-email:v1:');
  expect(durable.html).not.toContain(token);
  expect(durable.text).toBe('');
  expect(JSON.stringify(durable)).not.toContain(token);

  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  mockSendMail.mockResolvedValue({});
  const delivery = {
    ...queued,
    recipientUserId: null,
    publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:hash',
    attempts: 0,
  };
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));

  await expect(sendEmailDelivery(delivery, mockPrisma)).resolves.toMatchObject({ status: 'SENT' });
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
    html: expect.stringContaining(token),
    text: expect.stringContaining(token),
  }));
});

test('keeps encrypted confirmation emails retryable after delivery failure', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const token = 'retryable-confirmation-token';
  mockPrisma.emailDelivery.create.mockImplementation(async ({ data }) => ({ id: 'retry-confirmation', ...data }));
  const queued = await queueEmail({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:retry',
    recipientEmail: 'visitor@example.com',
    context: { title: 'Confirm', message: 'Confirm here.', link: `https://leamjobs.com/confirm?token=${token}` },
  });
  const delivery = {
    ...queued,
    recipientUserId: null,
    publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:retry',
    attempts: 0,
  };
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockSendMail.mockRejectedValueOnce(new Error('SMTP unavailable')).mockResolvedValueOnce({});

  await expect(sendEmailDelivery(delivery, mockPrisma)).resolves.toMatchObject({ status: 'FAILED' });
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED', nextAttemptAt: expect.any(Date) }),
  }));
  mockSendMail.mockClear();
  await expect(sendEmailDelivery({ ...delivery, attempts: 1 }, mockPrisma)).resolves.toMatchObject({ status: 'SENT' });
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining(token) }));
});

test('redacts confirmation content from transport errors in logs and persisted retry state', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const token = 'sensitive-confirmation-token';
  const privateContent = `https://leamjobs.com/confirm?token=${token}<p>${token}</p>`;
  mockPrisma.emailDelivery.create.mockImplementation(async ({ data }) => ({ id: 'redacted-confirmation', ...data }));
  const queued = await queueEmail({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:redacted',
    recipientEmail: 'visitor@example.com',
    context: { title: 'Confirm', message: 'Confirm here.', link: privateContent },
  });
  const delivery = {
    ...queued,
    recipientUserId: null,
    publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:redacted',
    attempts: 0,
  };
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockSendMail.mockRejectedValueOnce(new Error(`Email delivery failed: ${privateContent}`));
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

  try {
    await expect(sendEmailDelivery(delivery, mockPrisma)).resolves.toMatchObject({ status: 'FAILED' });
    expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        lastError: 'Job updates email delivery failed',
        nextAttemptAt: expect.any(Date),
      }),
    }));
    expect(errorLog).toHaveBeenCalledWith('Email delivery failed:', expect.objectContaining({
      emailType: 'JOB_UPDATES_SUBSCRIBED',
      deliveryId: 'redacted-confirmation',
      message: 'Job updates email delivery failed',
    }));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(token);
    expect(JSON.stringify(mockPrisma.emailDelivery.update.mock.calls)).not.toContain(token);
  } finally {
    errorLog.mockRestore();
  }
});

test('fails safely on missing or incorrect confirmation email encryption configuration', async () => {
  const token = 'configuration-test-token';
  mockPrisma.emailDelivery.create.mockImplementation(async ({ data }) => ({ id: 'config-confirmation', ...data }));
  const queued = await queueEmail({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:config',
    recipientEmail: 'visitor@example.com',
    context: { title: 'Confirm', message: 'Confirm here.', link: `https://leamjobs.com/confirm?token=${token}` },
  });
  const delivery = {
    ...queued,
    recipientUserId: null,
    publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:config',
    attempts: 0,
  };
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockSendMail.mockResolvedValue({});

  env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY = '';
  await expect(sendEmailDelivery(delivery, mockPrisma)).resolves.toMatchObject({ status: 'FAILED' });
  expect(mockSendMail).not.toHaveBeenCalled();

  env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY = 'different-job-updates-email-key-at-least-32-bytes';
  await expect(sendEmailDelivery({ ...delivery, attempts: 1 }, mockPrisma)).resolves.toMatchObject({ status: 'FAILED' });
  expect(mockSendMail).not.toHaveBeenCalled();
});

test('does not queue a confirmation when its encryption secret is missing', async () => {
  env.JOB_UPDATES_EMAIL_ENCRYPTION_KEY = '';
  await expect(queueEmail({
    publicSubscriberId: 'subscriber-1',
    emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:missing-key',
    recipientEmail: 'visitor@example.com',
    context: { title: 'Confirm', message: 'Confirm here.', link: 'https://leamjobs.com/confirm?token=secret' },
  })).rejects.toThrow('JOB_UPDATES_EMAIL_ENCRYPTION_KEY');
  expect(mockPrisma.emailDelivery.create).not.toHaveBeenCalled();
});

test('suppresses a pending confirmation after the subscriber has already confirmed', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'public-confirmation', recipientUserId: null, publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com', emailType: 'JOB_UPDATES_SUBSCRIBED',
    eventKey: 'public-job-updates:confirm:subscriber-1:hash', status: 'PENDING', attempts: 0,
    publicSubscriber: { isSubscribed: false },
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    email: 'visitor@example.com',
    isSubscribed: true,
  });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith({
    where: { id: 'public-confirmation' },
    data: {
      status: 'SUPPRESSED',
      suppressionReason: 'Subscription confirmation is no longer needed',
      lastError: null,
    },
  });
  expect(mockSendMail).not.toHaveBeenCalled();
});

test('suppresses a promotional delivery when the recipient opted out after queueing', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'delivery-promo', recipientUserId: 'user-1', recipientEmail: 'user@example.com',
    emailType: 'PROMOTIONAL_CAMPAIGN', communicationPurpose: 'PROMOTIONAL_MARKETING',
    eventKey: 'campaign:promo:user-1', status: 'PENDING', attempts: 0,
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.user.findUnique.mockResolvedValue({
    email: 'user@example.com', role: 'SEEKER', isActive: true, anonymizedAt: null, marketingEmailsEnabled: false,
  });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith({
    where: { id: 'delivery-promo' },
    data: { status: 'SUPPRESSED', suppressionReason: 'Recipient opted out of marketing emails', lastError: null },
  });
  expect(mockSendMail).not.toHaveBeenCalled();
});

test('suppresses a public campaign delivery if the subscriber unsubscribed after queueing', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'delivery-public', recipientUserId: null, publicSubscriberId: 'subscriber-1',
    recipientEmail: 'visitor@example.com', emailType: 'PROMOTIONAL_CAMPAIGN',
    communicationPurpose: 'PROMOTIONAL_MARKETING',
    eventKey: 'campaign:public:subscriber-1', status: 'PENDING', attempts: 0,
    publicSubscriber: { isSubscribed: true },
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.publicJobSubscriber.findUnique.mockResolvedValue({
    email: 'visitor@example.com',
    isSubscribed: false,
  });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);

  expect(mockPrisma.publicJobSubscriber.findUnique).toHaveBeenCalledWith({
    where: { id: 'subscriber-1' },
    select: { email: true, isSubscribed: true },
  });
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith({
    where: { id: 'delivery-public' },
    data: {
      status: 'SUPPRESSED',
      suppressionReason: 'Public subscriber is no longer subscribed',
      lastError: null,
    },
  });
  expect(mockSendMail).not.toHaveBeenCalled();
});

test.each(['SEEKER', 'EMPLOYER'])('sends an essential announcement to an opted-out active %s', async (role) => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  mockSendMail.mockResolvedValue({});
  const delivery = {
    id: 'delivery-essential', recipientUserId: 'user-2', recipientEmail: 'user@example.com',
    emailType: 'ESSENTIAL_ANNOUNCEMENT', communicationPurpose: 'ESSENTIAL_ANNOUNCEMENT',
    eventKey: 'campaign:essential:user-2', status: 'PENDING', attempts: 0,
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.user.findUnique.mockResolvedValue({
    email: 'user@example.com', role, isActive: true, anonymizedAt: null, marketingEmailsEnabled: false,
  });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(1);
  expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'user-2' },
    select: expect.objectContaining({ marketingEmailsEnabled: true }),
  }));
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }));
});

test.each([
  [{ email: 'changed@example.com', role: 'SEEKER', isActive: true, anonymizedAt: null, marketingEmailsEnabled: true }, 'Recipient email address changed after queueing'],
  [{ email: 'user@example.com', role: 'ADMIN', isActive: true, anonymizedAt: null, marketingEmailsEnabled: true }, 'Recipient account is no longer eligible'],
  [{ email: 'user@example.com', role: 'SEEKER', isActive: false, anonymizedAt: null, marketingEmailsEnabled: true }, 'Recipient account is no longer eligible'],
  [{ email: 'user@example.com', role: 'SEEKER', isActive: true, anonymizedAt: new Date(), marketingEmailsEnabled: true }, 'Recipient account is no longer eligible'],
])('suppresses an essential announcement for an ineligible account', async (user, reason) => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'delivery-ineligible', recipientUserId: 'user-3', recipientEmail: 'user@example.com',
    emailType: 'ESSENTIAL_ANNOUNCEMENT', communicationPurpose: 'ESSENTIAL_ANNOUNCEMENT',
    eventKey: 'campaign:essential:user-3', status: 'PENDING', attempts: 0,
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockPrisma.user.findUnique.mockResolvedValue(user);

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
  expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith({
    where: { id: 'delivery-ineligible' },
    data: { status: 'SUPPRESSED', suppressionReason: reason, lastError: null },
  });
  expect(mockSendMail).not.toHaveBeenCalled();
});

test('renders campaign headings and emphasis as email HTML', async () => {
  mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'delivery-2', status: 'PENDING', attempts: 0, recipientUserId: 'user-2', emailType: 'PROMOTIONAL_CAMPAIGN', eventKey: 'campaign:1:user-2' });
  await queueEmail({ recipientUserId: 'user-2', emailType: 'PROMOTIONAL_CAMPAIGN', eventKey: 'campaign:1:user-2', recipientEmail: 'seeker@example.com', context: { title: 'Discover more', message: '## Discover more\n\n**Explore LeamJobs today.**' } });
  const html = mockPrisma.emailDelivery.create.mock.calls[0][0].data.html;
  expect(html).toContain('<h2');
  expect(html).toContain('Discover more</h2>');
  expect(html).toContain('<strong>Explore LeamJobs today.</strong>');
  expect(html).not.toContain('## Discover more');
  expect(html).not.toContain('**Explore LeamJobs today.**');
});

test('disabled processor does not attempt SMTP work', async () => {
  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
  expect(mockPrisma.emailDelivery.findMany).not.toHaveBeenCalled();
});

test('email retries use exponential delays and claim stale deliveries with an updatedAt guard', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  jest.useFakeTimers();
  const now = new Date('2026-11-08T00:00:00.000Z');
  jest.setSystemTime(now);
  const delivery = {
    id: 'delivery-stale',
    recipientUserId: 'user-stale',
    recipientEmail: 'user@example.com',
    emailType: 'APPLICATION_SUBMITTED',
    eventKey: 'application:submitted:stale',
    status: 'PROCESSING',
    attempts: 2,
    updatedAt: new Date(now.getTime() - 16 * 60 * 1000),
    subject: 'Application submitted',
    html: '<p>Applied</p>',
    text: 'Applied',
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockSendMail.mockRejectedValue(new Error('temporary provider failure'));

  try {
    await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);
    expect(mockPrisma.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: delivery.id, status: 'PROCESSING', updatedAt: delivery.updatedAt },
      data: { status: 'PROCESSING' },
    });
    expect(mockPrisma.emailDelivery.update).toHaveBeenLastCalledWith({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        lastError: 'temporary provider failure',
        nextAttemptAt: new Date(now.getTime() + 20 * 60 * 1000),
      },
    });
  } finally {
    jest.useRealTimers();
  }
});

test('workers cannot both claim the same delivery', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'delivery-race',
    recipientUserId: 'user-race',
    recipientEmail: 'user@example.com',
    emailType: 'APPLICATION_SUBMITTED',
    eventKey: 'application:submitted:race',
    status: 'PENDING',
    attempts: 0,
    updatedAt: new Date(),
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  let claims = 0;
  mockPrisma.emailDelivery.updateMany.mockImplementation(async () => ({ count: claims++ === 0 ? 1 : 0 }));
  mockPrisma.emailDelivery.update.mockImplementation(async ({ data }) => ({ ...delivery, ...data }));
  mockSendMail.mockResolvedValue({});

  await Promise.all([
    processPendingEmails({ client: mockPrisma }),
    processPendingEmails({ client: mockPrisma }),
  ]);

  expect(mockPrisma.emailDelivery.updateMany).toHaveBeenCalledTimes(2);
  expect(mockSendMail).toHaveBeenCalledTimes(1);
});

test('stale deliveries at the attempt cap are marked failed without another send', async () => {
  env.EMAIL_ENABLED = true;
  env.EMAIL_HOST = 'smtp.invalid';
  env.EMAIL_USER = 'test-user';
  env.EMAIL_PASSWORD = 'test-password';
  const delivery = {
    id: 'delivery-capped',
    recipientUserId: 'user-capped',
    recipientEmail: 'user@example.com',
    emailType: 'APPLICATION_SUBMITTED',
    eventKey: 'application:submitted:capped',
    status: 'PROCESSING',
    attempts: 8,
    updatedAt: new Date(Date.now() - 16 * 60 * 1000),
  };
  mockPrisma.emailDelivery.findMany.mockResolvedValue([delivery]);
  mockPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailDelivery.update.mockResolvedValue({ ...delivery, status: 'FAILED' });

  await expect(processPendingEmails({ client: mockPrisma })).resolves.toBe(0);

  expect(mockPrisma.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      OR: expect.arrayContaining([
        expect.objectContaining({ status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 8 } }),
      ]),
    }),
  }));
  expect(mockPrisma.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: delivery.id },
    data: expect.objectContaining({
      status: 'FAILED',
      lastError: 'Maximum delivery attempts reached before the worker recovered.',
    }),
  }));
  expect(mockSendMail).not.toHaveBeenCalled();
});

test('unsubscribe tokens are signed and reject tampering', () => {
  const token = createUnsubscribeToken({ userId: 'user-1' });
  expect(verifyUnsubscribeToken('user-1', token)).toBe(true);
  expect(verifyUnsubscribeToken('user-2', token)).toBe(false);
  expect(verifyUnsubscribeToken('user-1', `${token}bad`)).toBe(false);
});
