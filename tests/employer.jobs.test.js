import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  job: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  employmentCompensation: { deleteMany: jest.fn() },
  contractCompensation: { deleteMany: jest.fn() },
  freelanceCompensation: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const employerA = '11111111-1111-4111-8111-111111111111';
const employerB = '22222222-2222-4222-8222-222222222222';
const jobA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const payload = (overrides = {}) => ({
  title: 'Senior Engineer',
  description: 'Build reliable product experiences.',
  location: 'Lagos',
  department: 'Engineering',
  workArrangement: 'REMOTE',
  engagementType: 'MONTHLY',
  jobType: 'NORMAL_EMPLOYMENT',
  requirements: ['Three years experience'],
  responsibilities: ['Build product features'],
  skills: ['React', 'TypeScript'],
  benefits: ['Health insurance'],
  applicationDeadline: '2026-12-31',
  monthlyCompensation: { salaryMin: 250000, salaryMax: 500000, currency: 'NGN' },
  contractCompensation: null,
  freelanceCompensation: null,
  ...overrides,
});

const jobRecord = (overrides = {}) => ({
  id: jobA,
  employerId: employerA,
  title: 'Senior Engineer',
  description: 'Build reliable product experiences.',
  location: 'Lagos',
  department: 'Engineering',
  workArrangement: 'REMOTE',
  engagementType: 'MONTHLY',
  jobType: 'NORMAL_EMPLOYMENT',
  skills: ['React', 'TypeScript'],
  requirements: ['Three years experience'],
  responsibilities: ['Build product features'],
  benefits: ['Health insurance'],
  status: 'PENDING',
  applicationDeadline: new Date('2026-12-31T00:00:00.000Z'),
  rejectionReason: null,
  reviewedAt: null,
  closedAt: null,
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  employer: { employerProfile: { companyName: 'Employer A', companyDescription: 'Real company', website: 'https://example.com', industry: 'Technology', location: 'Lagos', companyLogoUrl: null } },
  employmentCompensation: { salaryMin: 250000, salaryMax: 500000, currency: 'NGN', salaryPeriod: 'MONTHLY' },
  contractCompensation: null,
  freelanceCompensation: null,
  _count: { applications: 0 },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.job.findMany.mockResolvedValue([]);
  mockPrisma.job.findFirst.mockResolvedValue(null);
  mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.employmentCompensation.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.contractCompensation.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.freelanceCompensation.deleteMany.mockResolvedValue({ count: 0 });
});

describe('Employer Jobs authentication and ownership', () => {
  test('unauthenticated requests are rejected', async () => {
    const paths = [
      ['/api/employer/jobs', 'get'],
      ['/api/employer/jobs', 'post'],
      [`/api/employer/jobs/${jobA}`, 'get'],
      [`/api/employer/jobs/${jobA}`, 'patch'],
      [`/api/employer/jobs/${jobA}/close`, 'patch'],
    ];

    for (const [path, method] of paths) {
      const response = await request(app)[method](path).send(payload());
      expect(response.status).toBe(401);
    }
  });

  test.each(['SEEKER', 'ADMIN'])('%s cannot access Employer Jobs', async (role) => {
    const response = await request(app)
      .get('/api/employer/jobs')
      .set('Authorization', `Bearer ${token(role, 'restricted-user')}`);

    expect(response.status).toBe(403);
  });

  test('Employer A lists only Employer A jobs despite query identity values', async () => {
    mockPrisma.job.findMany.mockResolvedValue([jobRecord({ id: jobA, employerId: employerA })]);

    const response = await request(app)
      .get(`/api/employer/jobs?employerId=${employerB}&userId=${employerB}&role=ADMIN`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs).toHaveLength(1);
    expect(response.body.data.jobs[0].id).toBe(jobA);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employerId: employerA } }));
  });

  test('preserves legacy object-shaped requirements in the Employer API', async () => {
    const requirements = { education: "Bachelor's degree", experience: '2 years' };
    mockPrisma.job.findMany.mockResolvedValue([jobRecord({ requirements })]);

    const response = await request(app)
      .get('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs[0].requirements).toEqual(requirements);
  });

  test('Employer A cannot view Employer B job', async () => {
    const response = await request(app)
      .get(`/api/employer/jobs/${jobB}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobB, employerId: employerA } }));
  });

  test('Employer A cannot update or close Employer B job', async () => {
    const updateResponse = await request(app)
      .patch(`/api/employer/jobs/${jobB}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload());
    const closeResponse = await request(app)
      .patch(`/api/employer/jobs/${jobB}/close`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(updateResponse.status).toBe(404);
    expect(closeResponse.status).toBe(404);
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobB, employerId: employerA } }));
  });
});

describe('Employer Jobs creation and compensation', () => {
  test('creates a PENDING monthly job for the authenticated employer only', async () => {
    mockPrisma.job.create.mockImplementation(async ({ data }) => jobRecord({
      ...data,
      id: jobA,
      applicationDeadline: data.applicationDeadline,
      employmentCompensation: data.employmentCompensation.create,
    }));

    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload());

    expect(response.status).toBe(201);
    expect(mockPrisma.job.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ employerId: employerA, status: 'PENDING', skills: ['React', 'TypeScript'], responsibilities: ['Build product features'], benefits: ['Health insurance'] }),
    }));
    expect(response.body.data.job.status).toBe('PENDING');
  });

  test('rejects client-provided identity fields instead of trusting them', async () => {
    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({ employerId: employerB, userId: employerB, role: 'ADMIN' }));

    expect(response.status).toBe(400);
    expect(mockPrisma.job.create).not.toHaveBeenCalled();
  });

  test('persists contract compensation and duration', async () => {
    mockPrisma.job.create.mockImplementation(async ({ data }) => jobRecord({
      ...data,
      engagementType: 'CONTRACT',
      contractCompensation: data.contractCompensation.create,
      employmentCompensation: null,
    }));

    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({
        engagementType: 'CONTRACT',
        contractCompensation: { amount: 1500000, currency: 'NGN', duration: '6 months' },
        monthlyCompensation: null,
      }));

    expect(response.status).toBe(201);
    expect(mockPrisma.job.create.mock.calls[0][0].data.contractCompensation.create).toEqual({ amount: 1500000, currency: 'NGN', duration: '6 months' });
    expect(response.body.data.job.compensation).toMatchObject({ type: 'CONTRACT', duration: '6 months' });
  });

  test('returns an empty benefits list when benefits are omitted', async () => {
    mockPrisma.job.create.mockImplementation(async ({ data }) => jobRecord({
      ...data,
      id: jobA,
      applicationDeadline: data.applicationDeadline,
      employmentCompensation: data.employmentCompensation.create,
    }));

    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({ benefits: undefined }));

    expect(response.status).toBe(201);
    expect(response.body.data.job.benefits).toEqual([]);
  });

  test('persists freelance compensation', async () => {
    mockPrisma.job.create.mockImplementation(async ({ data }) => jobRecord({
      ...data,
      engagementType: 'FREELANCE',
      jobType: 'FREELANCE_PROJECT',
      freelanceCompensation: data.freelanceCompensation.create,
      employmentCompensation: null,
    }));

    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({
        engagementType: 'FREELANCE',
        jobType: 'FREELANCE_PROJECT',
        monthlyCompensation: null,
        freelanceCompensation: { projectAmount: 800000, currency: 'NGN' },
      }));

    expect(response.status).toBe(201);
    expect(response.body.data.job.compensation).toMatchObject({ type: 'FREELANCE', projectAmount: '800000' });
  });

  test('rejects invalid compensation combinations and approved status input', async () => {
    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({ engagementType: 'CONTRACT', jobType: 'FREELANCE_PROJECT', status: 'APPROVED', contractCompensation: null }));

    expect(response.status).toBe(400);
    expect(mockPrisma.job.create).not.toHaveBeenCalled();
  });

  test.each([
    ['MONTHLY', { contractCompensation: { amount: 500000, currency: 'NGN', duration: '6 months' } }],
    ['MONTHLY', { freelanceCompensation: { projectAmount: 500000, currency: 'NGN' } }],
    ['CONTRACT', { monthlyCompensation: { salaryMin: 100000, salaryMax: 200000, currency: 'NGN' }, contractCompensation: { amount: 500000, currency: 'NGN', duration: '6 months' } }],
    ['CONTRACT', { freelanceCompensation: { projectAmount: 500000, currency: 'NGN' }, contractCompensation: { amount: 500000, currency: 'NGN', duration: '6 months' }, monthlyCompensation: null }],
    ['FREELANCE', { monthlyCompensation: { salaryMin: 100000, salaryMax: 200000, currency: 'NGN' }, freelanceCompensation: { projectAmount: 500000, currency: 'NGN' } }],
    ['FREELANCE', { contractCompensation: { amount: 500000, currency: 'NGN', duration: '6 months' }, freelanceCompensation: { projectAmount: 500000, currency: 'NGN' }, monthlyCompensation: null }],
  ])('rejects irrelevant compensation for %s jobs', async (engagementType, compensation) => {
    const response = await request(app)
      .post('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({ engagementType, jobType: engagementType === 'FREELANCE' ? 'FREELANCE_PROJECT' : 'NORMAL_EMPLOYMENT', ...compensation }));

    expect(response.status).toBe(400);
    expect(mockPrisma.job.create).not.toHaveBeenCalled();
  });

  test('returns an empty list for an employer with no jobs', async () => {
    const response = await request(app)
      .get('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs).toEqual([]);
  });
});

describe('Public approved job visibility', () => {
  const pendingJobId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const rejectedJobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const closedJobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const approvedJobId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  test.each([
    ['PENDING', pendingJobId],
    ['REJECTED', rejectedJobId],
    ['CLOSED', closedJobId],
  ])('does not expose %s jobs publicly', async (status, jobId) => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    const response = await request(app).get(`/api/jobs/${jobId}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobId, status: 'APPROVED' } }));
  });

  test('returns approved jobs without private or internal fields', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ id: approvedJobId, status: 'APPROVED', rejectionReason: 'private', reviewedById: 'reviewer-id', reviewedAt: new Date() }));

    const response = await request(app).get(`/api/jobs/${approvedJobId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.job).toMatchObject({ id: approvedJobId, title: 'Senior Engineer' });
    expect(response.body.data.job).not.toHaveProperty('rejectionReason');
    expect(response.body.data.job).not.toHaveProperty('reviewedById');
    expect(response.body.data.job).not.toHaveProperty('reviewedAt');
    expect(response.body.data.job).not.toHaveProperty('applications');
    expect(response.body.data.job).not.toHaveProperty('password');
  });
});

describe('Employer Jobs editing and closing', () => {
  test('updates an owned job without allowing employerId changes', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord());
    const updated = jobRecord({ title: 'Updated Engineer' });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employmentCompensation: mockPrisma.employmentCompensation,
      contractCompensation: mockPrisma.contractCompensation,
      freelanceCompensation: mockPrisma.freelanceCompensation,
      job: { update: jest.fn().mockResolvedValue(updated) },
    }));

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobA}?employerId=${employerB}&userId=${employerB}&role=ADMIN`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(payload({ title: 'Updated Engineer' }));

    expect(response.status).toBe(200);
    expect(response.body.data.job.title).toBe('Updated Engineer');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  test('closes an owned job and returns CLOSED', async () => {
    mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'CLOSED', closedAt: new Date() }));

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobA}/close`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.job.status).toBe('CLOSED');
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CLOSED', closedAt: expect.any(Date) } }));
  });
});
