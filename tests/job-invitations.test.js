import { jest } from '@jest/globals';

const mockPrisma = {
  job: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
  jobInvitation: { findFirst: jest.fn() },
  application: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
const { createJobInvitation, respondToJobInvitation } = await import('../src/services/jobInvitation.service.js');

const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const invitationId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const applicationId = '66666666-6666-4666-8666-666666666666';

const job = {
  id: jobId,
  title: 'Senior Python Developer',
  applicationDeadline: null,
  employer: { employerProfile: { companyName: 'ABC Technologies' } },
};

const invitation = (overrides = {}) => ({
  id: invitationId,
  status: 'PENDING',
  message: 'We would love you to apply.',
  createdAt: new Date('2026-09-14T00:00:00.000Z'),
  respondedAt: null,
  expiresAt: null,
  job: { ...job, status: 'APPROVED', location: 'Lagos' },
  employer: { id: employerId, firstName: 'Ada', lastName: 'Employer', employerProfile: { companyName: 'ABC Technologies', companyLogoUrl: null } },
  seeker: { id: seekerId, firstName: 'Grace', lastName: 'Seeker' },
  application: null,
  ...overrides,
});

const setupCreateTransaction = (created = invitation()) => {
  const transaction = {
    conversation: { create: jest.fn().mockResolvedValue({ id: conversationId }) },
    jobInvitation: { create: jest.fn().mockResolvedValue(created) },
    message: { create: jest.fn().mockResolvedValue({ id: 'message-1' }) },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));
  return transaction;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.job.findFirst.mockResolvedValue(job);
  mockPrisma.user.findFirst.mockResolvedValue({ id: seekerId });
  mockPrisma.jobInvitation.findFirst.mockResolvedValue(null);
});

describe('job invitations', () => {
  test('employer can invite an eligible seeker to an owned approved job', async () => {
    const transaction = setupCreateTransaction();

    const result = await createJobInvitation(employerId, { seekerId, jobId, message: 'We would love you to apply.' });

    expect(result.status).toBe('PENDING');
    expect(transaction.conversation.create).toHaveBeenCalledWith({ data: { employerId, seekerId, jobId, lastMessageAt: expect.any(Date) } });
    expect(transaction.jobInvitation.create).toHaveBeenCalledWith(expect.objectContaining({ data: { employerId, seekerId, jobId, message: 'We would love you to apply.', conversationId } }));
    expect(transaction.message.create).toHaveBeenCalledWith({ data: { conversationId, senderId: employerId, body: expect.stringContaining('JOB INVITATION') } });
  });

  test('rejects another employer job, inactive/missing-profile seekers, closed jobs, and expired jobs', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);
    await expect(createJobInvitation(employerId, { seekerId, jobId, message: 'Apply.' })).rejects.toMatchObject({ status: 404 });

    mockPrisma.job.findFirst.mockResolvedValue(job);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(createJobInvitation(employerId, { seekerId, jobId, message: 'Apply.' })).rejects.toMatchObject({ status: 404 });

    mockPrisma.user.findFirst.mockResolvedValue({ id: seekerId });
    mockPrisma.job.findFirst.mockResolvedValue({ ...job, applicationDeadline: new Date('2020-01-01T00:00:00.000Z') });
    await expect(createJobInvitation(employerId, { seekerId, jobId, message: 'Apply.' })).rejects.toMatchObject({ status: 409 });
  });

  test('prevents duplicate pending invitations', async () => {
    mockPrisma.jobInvitation.findFirst.mockResolvedValue({ id: invitationId });
    await expect(createJobInvitation(employerId, { seekerId, jobId, message: 'Apply.' })).rejects.toMatchObject({ status: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('acceptance creates exactly one application and is idempotent', async () => {
    const transaction = {
      $queryRaw: jest.fn(),
      jobInvitation: {
        findFirst: jest.fn().mockResolvedValueOnce(invitation()).mockResolvedValueOnce(invitation({ status: 'ACCEPTED', applicationId })),
        update: jest.fn().mockResolvedValue(invitation({ status: 'ACCEPTED', applicationId, application: { id: applicationId, status: 'APPLIED', jobId } })),
      },
      application: {
        findUnique: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue({ id: applicationId, status: 'APPLIED', jobId }),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

    const accepted = await respondToJobInvitation(seekerId, invitationId, 'ACCEPTED');
    expect(accepted.status).toBe('ACCEPTED');
    expect(transaction.application.create).toHaveBeenCalledTimes(1);
    expect(transaction.jobInvitation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED', applicationId }) }));

    const acceptedAgain = await respondToJobInvitation(seekerId, invitationId, 'ACCEPTED');
    expect(acceptedAgain.status).toBe('ACCEPTED');
    expect(transaction.application.create).toHaveBeenCalledTimes(1);
  });

  test('declining updates the invitation and never creates an application', async () => {
    const transaction = {
      $queryRaw: jest.fn(),
      jobInvitation: {
        findFirst: jest.fn().mockResolvedValue(invitation()),
        update: jest.fn().mockResolvedValue(invitation({ status: 'DECLINED', respondedAt: new Date() })),
      },
      application: { findUnique: jest.fn(), create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

    const declined = await respondToJobInvitation(seekerId, invitationId, 'DECLINED');
    expect(declined.status).toBe('DECLINED');
    expect(transaction.application.create).not.toHaveBeenCalled();
  });

  test('cannot respond to another seeker invitation', async () => {
    const transaction = { $queryRaw: jest.fn(), jobInvitation: { findFirst: jest.fn().mockResolvedValue(null) } };
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));
    await expect(respondToJobInvitation('77777777-7777-4777-8777-777777777777', invitationId, 'ACCEPTED')).rejects.toMatchObject({ status: 404 });
  });
});
