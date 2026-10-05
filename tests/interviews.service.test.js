import { jest } from '@jest/globals';

const mockPrisma = {
  $transaction: jest.fn(),
  interview: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
  },
};
const createNotification = jest.fn().mockResolvedValue({});
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({ createNotification }));
const { cancelInterview, createInterview, getInterviewForUser, listEmployerInterviews, updateInterview } = await import('../src/services/interviews.service.js');
const { validateCreateInterview } = await import('../src/validators/interviews.validation.js');

const employerId = '11111111-1111-4111-8111-111111111111';
const anotherEmployerId = '22222222-2222-4222-8222-222222222222';
const seekerId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const applicationId = '55555555-5555-4555-8555-555555555555';
const interviewId = '66666666-6666-4666-8666-666666666666';
const schedule = (localDate = '2030-05-01', localTime = '12:00', timezone = 'UTC') => ({ localDate, localTime, timezone });

const interviewRecord = (overrides = {}) => ({
  id: interviewId,
  applicationId,
  jobId,
  employerId,
  seekerId,
  method: 'VIDEO',
  status: 'SCHEDULED',
  scheduledAt: new Date('2030-05-01T12:00:00.000Z'),
  timezone: 'UTC',
  durationMinutes: 30,
  message: 'Please join a few minutes early.',
  meetingUrl: 'https://meet.example.com/room',
  phoneNumber: null,
  location: null,
  previousApplicationStatus: 'SHORTLISTED',
  cancelledAt: null,
  createdAt: new Date('2030-04-01T12:00:00.000Z'),
  updatedAt: new Date('2030-04-01T12:00:00.000Z'),
  job: { id: jobId, title: 'Engineer', location: 'Lagos', jobType: 'NORMAL_EMPLOYMENT' },
  employer: { id: employerId, firstName: 'Ada', lastName: 'Employer', employerProfile: { companyName: 'Acme' } },
  seeker: { id: seekerId, firstName: 'Grace', lastName: 'Seeker', seekerProfile: { professionalTitle: 'Developer' } },
  application: { conversation: { id: 'conversation-1' } },
  history: [
    { event: 'CREATED', createdAt: new Date('2030-04-01T12:00:00.000Z'), before: null, after: { scheduledAt: '2030-05-01T12:00:00.000Z', timezone: 'UTC' } },
    { event: 'RESCHEDULED', createdAt: new Date('2030-04-02T12:00:00.000Z'), before: { scheduledAt: '2030-05-01T12:00:00.000Z', timezone: 'UTC' }, after: { scheduledAt: '2030-05-02T12:00:00.000Z', timezone: 'UTC' } },
  ],
  ...overrides,
});

let tx;
const setupTransaction = () => {
  tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    application: {
      findFirst: jest.fn().mockResolvedValue({
        id: applicationId,
        jobId,
        seekerId,
        status: 'SHORTLISTED',
        job: { id: jobId, title: 'Engineer', employerId },
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    interview: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: interviewId }),
      findUnique: jest.fn().mockResolvedValue(interviewRecord()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    interviewHistory: { create: jest.fn().mockResolvedValue({}) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'message-1' }) },
  };
  mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
  return tx;
};

beforeEach(() => {
  jest.clearAllMocks();
  createNotification.mockResolvedValue({});
});

describe('interview scheduling', () => {
  test('creates interviews from owned application relations and atomically sets INTERVIEW', async () => {
    const transaction = setupTransaction();
    const result = await createInterview(employerId, jobId, applicationId, {
      method: 'VIDEO',
      ...schedule(),
      meetingUrl: 'https://meet.example.com/room',
      message: 'Please join a few minutes early.',
      seekerId: anotherEmployerId,
      employerId: anotherEmployerId,
      jobId: anotherEmployerId,
    });

    expect(result.id).toBe(interviewId);
    expect(result).toEqual(expect.objectContaining({
      applicationId,
      scheduledAt: '2030-05-01T12:00:00.000Z',
      method: 'VIDEO',
      durationMinutes: 30,
      status: 'SCHEDULED',
      applicant: expect.objectContaining({ fullName: 'Grace Seeker' }),
      job: expect.objectContaining({ title: 'Engineer' }),
      companyName: 'Acme',
      actions: { canEdit: true, canCancel: true, canRespond: false },
      events: [
        { eventType: 'CREATED', createdAt: expect.any(String), newSchedule: { scheduledAt: '2030-05-01T12:00:00.000Z', timezone: 'UTC' } },
        { eventType: 'RESCHEDULED', createdAt: expect.any(String), oldSchedule: { scheduledAt: '2030-05-01T12:00:00.000Z', timezone: 'UTC' }, newSchedule: { scheduledAt: '2030-05-02T12:00:00.000Z', timezone: 'UTC' } },
      ],
    }));
    expect(transaction.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: applicationId, jobId, job: { employerId } },
    }));
    expect(transaction.interview.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        employerId,
        seekerId,
        jobId,
        applicationId,
        previousApplicationStatus: 'SHORTLISTED',
        method: 'VIDEO',
      }),
    }));
    expect(transaction.application.update).toHaveBeenCalledWith({ where: { id: applicationId }, data: { status: 'INTERVIEW' } });
    expect(transaction.interviewHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ event: 'CREATED', actorId: employerId }),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: seekerId,
      eventKey: expect.stringMatching(/^interview:scheduled:/),
    }), transaction);
  });

  test('rejects non-owned applications, inactive applications, and duplicate active interviews', async () => {
    const transaction = setupTransaction();
    transaction.application.findFirst.mockResolvedValue(null);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule(), phoneNumber: '+2348012345678',
    })).rejects.toMatchObject({ status: 404 });

    transaction.application.findFirst.mockResolvedValue({ id: applicationId, status: 'WITHDRAWN' });
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule(), phoneNumber: '+2348012345678',
    })).rejects.toMatchObject({ status: 409 });

    transaction.application.findFirst.mockResolvedValue({ id: applicationId, status: 'SHORTLISTED' });
    transaction.interview.findFirst.mockResolvedValue({ id: interviewId });
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule(), phoneNumber: '+2348012345678',
    })).rejects.toMatchObject({ status: 409 });
    expect(transaction.interview.create).not.toHaveBeenCalled();
  });

  test('converts local times and rejects invalid zones, past times, and DST gaps or overlaps', async () => {
    setupTransaction();
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-05-01', '12:00', 'Not/AZone'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/IANA time zone/);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2020-05-01'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/future/);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-03-10', '02:30', 'America/New_York'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/does not exist/);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-11-03', '01:30', 'America/New_York'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/ambiguous/);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-02-30'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/valid date\/time/);
    await expect(createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-05-01', '12:00', '+03:00'), phoneNumber: '+2348012345678',
    })).rejects.toThrow(/named IANA/);

    const transaction = setupTransaction();
    await createInterview(employerId, jobId, applicationId, {
      method: 'PHONE', ...schedule('2030-05-01', '12:00', 'Africa/Lagos'), phoneNumber: '+2348012345678',
    });
    expect(transaction.interview.create.mock.calls[0][0].data.scheduledAt.toISOString()).toBe('2030-05-01T11:00:00.000Z');
  });

  test('enforces method-specific meeting requirements and HTTPS links', async () => {
    setupTransaction();
    const base = schedule();
    await expect(createInterview(employerId, jobId, applicationId, { ...base, method: 'VIDEO' })).rejects.toThrow(/meetingUrl is required/);
    await expect(createInterview(employerId, jobId, applicationId, {
      ...base, method: 'VIDEO', meetingUrl: 'javascript:alert(1)',
    })).rejects.toThrow(/HTTPS URL/);
    await expect(createInterview(employerId, jobId, applicationId, { ...base, method: 'IN_PERSON' })).rejects.toThrow(/location is required/);
    await expect(createInterview(employerId, jobId, applicationId, {
      ...base, method: 'WHATSAPP', phoneNumber: 'invalid number!',
    })).rejects.toThrow(/valid international phone/);
    await expect(createInterview(employerId, jobId, applicationId, {
      ...base, method: 'WHATSAPP', phoneNumber: '2348012345678',
    })).rejects.toThrow(/starting with \+/);
  });

  test('reuses the application conversation for LEAMJOBS without returning its identifier', async () => {
    const transaction = setupTransaction();
    transaction.conversation.findUnique.mockResolvedValue({ id: 'existing-conversation' });
    const result = await createInterview(employerId, jobId, applicationId, {
      method: 'LEAMJOBS', ...schedule(), message: 'See you then.',
    });
    expect(transaction.conversation.create).not.toHaveBeenCalled();
    expect(transaction.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'existing-conversation', senderId: employerId, body: expect.stringContaining('INTERVIEW Engineer') }),
    }));
    expect(result.conversationId).toBeUndefined();
  });

  test('returns only the method-specific seeker contact and application-message actions', async () => {
    const recordWithPhone = interviewRecord({
      method: 'WHATSAPP',
      phoneNumber: '+2348012345678',
      application: { conversation: { id: 'safe-conversation-id' } },
    });
    mockPrisma.interview.findFirst.mockResolvedValue(recordWithPhone);
    const seekerView = await getInterviewForUser(seekerId, 'SEEKER', interviewId);
    expect(seekerView).toEqual(expect.objectContaining({
      method: 'WHATSAPP',
      whatsappNumber: '+2348012345678',
      messageUrl: '/seeker/messages?conversationId=safe-conversation-id',
      employer: expect.objectContaining({ companyName: 'Acme' }),
    }));
    expect(seekerView).not.toHaveProperty('applicant');
    expect(seekerView).not.toHaveProperty('phoneNumber');
    expect(seekerView).not.toHaveProperty('whatsappUrl');

    mockPrisma.interview.findFirst.mockResolvedValue(interviewRecord({
      method: 'PHONE',
      phoneNumber: '+2348012345678',
    }));
    const phoneView = await getInterviewForUser(seekerId, 'SEEKER', interviewId);
    expect(phoneView).toEqual(expect.objectContaining({
      method: 'PHONE',
      phoneNumber: '+2348012345678',
    }));
    expect(phoneView).not.toHaveProperty('whatsappNumber');
    expect(phoneView).not.toHaveProperty('whatsappUrl');
    expect(phoneView).not.toHaveProperty('otherContactNumber');

    mockPrisma.interview.findFirst.mockResolvedValue(recordWithPhone);
    const employerView = await getInterviewForUser(employerId, 'EMPLOYER', interviewId);
    expect(employerView).not.toHaveProperty('whatsappNumber');
    expect(employerView).not.toHaveProperty('whatsappUrl');
    expect(employerView).not.toHaveProperty('messageUrl');
  });

  test('rescheduling records history and cancellation restores the previous status only while still INTERVIEW', async () => {
    const transaction = setupTransaction();
    const current = interviewRecord();
    mockPrisma.interview.findFirst.mockResolvedValueOnce({
      id: interviewId, applicationId, method: current.method, status: current.status,
      scheduledAt: current.scheduledAt, timezone: current.timezone, durationMinutes: current.durationMinutes,
      message: current.message, meetingUrl: current.meetingUrl, phoneNumber: current.phoneNumber, location: current.location,
    });
    transaction.interview.findFirst.mockResolvedValue(current);
    transaction.interview.findUnique.mockResolvedValue(interviewRecord({ scheduledAt: new Date('2030-05-02T12:00:00.000Z') }));
    const updated = await updateInterview(employerId, interviewId, schedule('2030-05-02'));
    expect(updated.scheduledAt).toBe('2030-05-02T12:00:00.000Z');
    expect(transaction.interviewHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ event: 'RESCHEDULED' }),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ eventKey: expect.stringMatching(/^interview:rescheduled:/) }), transaction);

    const cancellationTx = setupTransaction();
    cancellationTx.interview.findFirst.mockResolvedValue(current);
    cancellationTx.interview.findUnique.mockResolvedValue(interviewRecord({ status: 'CANCELLED', cancelledAt: new Date() }));
    mockPrisma.interview.findFirst.mockResolvedValueOnce({ applicationId });
    const cancelled = await cancelInterview(employerId, interviewId, 'Candidate requested a different time.');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancellationTx.application.updateMany).toHaveBeenCalledWith({
      where: { id: applicationId, status: 'INTERVIEW' },
      data: { status: 'SHORTLISTED' },
    });
    expect(cancellationTx.interviewHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        event: 'CANCELLED',
        after: expect.objectContaining({ reason: 'Candidate requested a different time.' }),
      }),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ eventKey: expect.stringMatching(/^interview:cancelled:/) }), cancellationTx);
  });

  test('scopes lists and details to authenticated role identity', async () => {
    mockPrisma.interview.findMany.mockResolvedValue([]);
    mockPrisma.interview.count.mockResolvedValue(0);
    await listEmployerInterviews(employerId, { page: 1, limit: 20 });
    expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employerId },
    }));

    mockPrisma.interview.findFirst.mockResolvedValue(null);
    await expect(getInterviewForUser(anotherEmployerId, 'EMPLOYER', interviewId)).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.interview.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: interviewId, employerId: anotherEmployerId },
    }));

    mockPrisma.interview.findFirst.mockResolvedValue(interviewRecord());
    const seekerView = await getInterviewForUser(seekerId, 'SEEKER', interviewId);
    expect(seekerView).toEqual(expect.objectContaining({
      applicationId,
      scheduledAt: '2030-05-01T12:00:00.000Z',
      employer: expect.objectContaining({ id: employerId, companyName: 'Acme' }),
      job: expect.objectContaining({ id: jobId, title: 'Engineer' }),
      actions: { canEdit: false, canCancel: false, canRespond: false },
    }));
    expect(seekerView).not.toHaveProperty('applicant');
  });

  test('rejects client-supplied identity fields at the request boundary', () => {
    const req = { body: { method: 'PHONE', ...schedule(), phoneNumber: '+2348012345678', seekerId } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    validateCreateInterview(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
