import { jest } from '@jest/globals';
import request from 'supertest';

process.env.NODE_ENV = 'test';

const employerId = '11111111-1111-4111-8111-111111111111';
const unknownEmployerId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const secondJobId = '44444444-4444-4444-8444-444444444444';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  employerVerification: { findUnique: jest.fn() },
  job: { count: jest.fn(), findMany: jest.fn() },
  application: { count: jest.fn() },
  contract: { count: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const companyProfile = {
  companyName: 'Example Ltd',
  companyDescription: 'A public company description.',
  website: 'https://example.test',
  industry: 'Technology',
  companySize: '51-200',
  location: 'Lagos',
  address: '1 Example Street',
  state: 'Lagos',
  country: 'Nigeria',
  linkedinUrl: 'https://linkedin.com/company/example',
  twitterUrl: 'https://x.com/example',
  facebookUrl: 'https://facebook.com/example',
  companyLogoUrl: '/api/employer/profile/logo',
};

const publicJob = {
  id: jobId,
  employerId,
  title: 'Frontend Developer',
  description: 'Build public interfaces.',
  location: 'Lagos',
  department: 'Engineering',
  workArrangement: 'REMOTE',
  engagementType: 'MONTHLY',
  jobType: 'NORMAL_EMPLOYMENT',
  skills: ['React'],
  requirements: ['Experience'],
  responsibilities: ['Build'],
  benefits: [],
  applicationDeadline: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  employer: { employerProfile: companyProfile },
  employmentCompensation: { salaryMin: { toString: () => '100000' }, salaryMax: { toString: () => '200000' }, currency: 'NGN', salaryPeriod: 'MONTHLY' },
  freelanceCompensation: null,
  contractCompensation: null,
};

const secondPublicJob = {
  ...publicJob,
  id: secondJobId,
  title: 'Backend Developer',
  createdAt: new Date('2026-09-02T00:00:00.000Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ employerProfile: companyProfile });
  mockPrisma.employerVerification.findUnique.mockResolvedValue({ status: 'APPROVED' });
  mockPrisma.job.count.mockResolvedValue(2);
  mockPrisma.application.count.mockResolvedValue(7);
  mockPrisma.contract.count.mockResolvedValue(3);
  mockPrisma.job.findMany.mockResolvedValue([publicJob]);
});

test('returns a public company profile without authentication', async () => {
  const response = await request(app).get(`/api/public/companies/${employerId}`);

  expect(response.status).toBe(200);
  expect(response.body.data.company).toMatchObject({
    id: employerId,
    name: 'Example Ltd',
    verified: true,
    industry: 'Technology',
    address: '1 Example Street',
  });
  expect(response.body.data.statistics).toEqual({ jobsPosted: 2, applicants: 7, candidatesSelected: 3 });
  expect(response.body.data.jobs[0]).toMatchObject({ id: jobId, employerId, title: 'Frontend Developer' });
  expect(JSON.stringify(response.body)).not.toContain('companyLogoKey');
  expect(JSON.stringify(response.body)).not.toContain('registrationNumber');
  expect(JSON.stringify(response.body)).not.toContain('cacNumber');
  expect(JSON.stringify(response.body)).not.toContain('bnNumber');
  expect(JSON.stringify(response.body)).not.toContain('objectKey');
  expect(JSON.stringify(response.body)).not.toContain('documents');
  expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  expect(JSON.stringify(response.body)).not.toContain('phoneNumber');
  expect(JSON.stringify(response.body)).not.toContain('wallet');
  expect(JSON.stringify(response.body)).not.toContain('payment');
  expect(JSON.stringify(response.body)).not.toContain('ledger');
  expect(response.body.data).not.toHaveProperty('applicantNames');
  expect(response.body.data).not.toHaveProperty('applicantProfiles');
  expect(response.body.data.jobs[0]).not.toHaveProperty('applications');
  expect(response.body.data.company).not.toHaveProperty('revenue');
  expect(mockPrisma.application.count).toHaveBeenCalledWith({ where: { job: { employerId, status: 'APPROVED' } } });
  expect(mockPrisma.contract.count).toHaveBeenCalledWith({ where: { employerId, status: { not: 'CANCELLED' }, job: { status: 'APPROVED' } } });
});

test.each(['PENDING', 'REJECTED'])('does not mark %s verification as verified', async (status) => {
  mockPrisma.employerVerification.findUnique.mockResolvedValue({ status });

  const response = await request(app).get(`/api/public/companies/${employerId}`);

  expect(response.status).toBe(200);
  expect(response.body.data.company.verified).toBe(false);
});

test('returns 404 for an unknown employer', async () => {
  mockPrisma.user.findUnique.mockResolvedValue(null);

  const response = await request(app).get(`/api/public/companies/${unknownEmployerId}`);

  expect(response.status).toBe(404);
  expect(response.body.message).toBe('Company not found');
});

test('rejects an invalid employer identifier before querying the database', async () => {
  const response = await request(app).get('/api/public/companies/not-an-id');

  expect(response.status).toBe(400);
  expect(response.body.message).toBe('Invalid company identifier');
  expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
});

test('returns only approved jobs for the company', async () => {
  const mixedJobs = [
    { ...publicJob, status: 'APPROVED' },
    { ...secondPublicJob, status: 'PENDING' },
    { ...secondPublicJob, id: '55555555-5555-4555-8555-555555555555', status: 'REJECTED' },
    { ...secondPublicJob, id: '66666666-6666-4666-8666-666666666666', status: 'CLOSED' },
  ];
  mockPrisma.job.findMany.mockImplementation(async ({ where, skip = 0, take }) => mixedJobs
    .filter((job) => where.status === job.status)
    .slice(skip, skip + take));

  const response = await request(app).get(`/api/public/companies/${employerId}`);

  expect(response.status).toBe(200);
  expect(response.body.data.jobs).toHaveLength(1);
  expect(response.body.data.jobs.map((job) => job.id)).toEqual([jobId]);
  expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { employerId, status: 'APPROVED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: 0,
    take: 12,
    select: expect.any(Object),
  }));
});

test('supports paginated job loading with metadata', async () => {
  const approvedJobs = [publicJob, secondPublicJob, { ...publicJob, id: '77777777-7777-4777-8777-777777777777', title: 'QA Developer' }];
  mockPrisma.job.count.mockResolvedValue(approvedJobs.length);
  mockPrisma.job.findMany.mockImplementation(async ({ skip = 0, take }) => approvedJobs.slice(skip, skip + take));

  const firstPage = await request(app).get(`/api/public/companies/${employerId}?page=1&limit=2`);

  expect(firstPage.status).toBe(200);
  expect(firstPage.body.data.pagination).toEqual({
    page: 1,
    limit: 2,
    total: 3,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
  });
  expect(firstPage.body.data.jobs).toHaveLength(2);
  expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
    skip: 0,
    take: 2,
  }));

  const secondPage = await request(app).get(`/api/public/companies/${employerId}?page=2&limit=2`);

  expect(secondPage.body.data.pagination).toEqual({
    page: 2,
    limit: 2,
    total: 3,
    totalPages: 2,
    hasNextPage: false,
    hasPreviousPage: true,
  });
  expect(secondPage.body.data.jobs).toHaveLength(1);
  expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
    skip: 2,
    take: 2,
  }));

  const beyondFinalPage = await request(app).get(`/api/public/companies/${employerId}?page=3&limit=2`);

  expect(beyondFinalPage.body.data.pagination).toEqual({
    page: 3,
    limit: 2,
    total: 3,
    totalPages: 2,
    hasNextPage: false,
    hasPreviousPage: true,
  });
  expect(beyondFinalPage.body.data.jobs).toEqual([]);
});

test('accepts the maximum page size and rejects invalid pagination values safely', async () => {
  const maximumPage = await request(app).get(`/api/public/companies/${employerId}?page=1&limit=24`);

  expect(maximumPage.status).toBe(200);
  expect(maximumPage.body.data.pagination.limit).toBe(24);
  expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 24 }));

  const invalidLimit = await request(app).get(`/api/public/companies/${employerId}?page=1&limit=25`);
  const invalidPage = await request(app).get(`/api/public/companies/${employerId}?page=1.5&limit=12`);
  const invalidZeroPage = await request(app).get(`/api/public/companies/${employerId}?page=0&limit=12`);

  expect(invalidLimit.status).toBe(400);
  expect(invalidLimit.body.message).toBe('Validation failed');
  expect(invalidPage.status).toBe(400);
  expect(invalidPage.body.message).toBe('Validation failed');
  expect(invalidZeroPage.status).toBe(400);
  expect(invalidZeroPage.body.message).toBe('Validation failed');
});

test('returns an explicit empty jobs list when the company has no approved jobs', async () => {
  mockPrisma.job.count.mockResolvedValue(0);
  mockPrisma.application.count.mockResolvedValue(0);
  mockPrisma.contract.count.mockResolvedValue(0);
  mockPrisma.job.findMany.mockResolvedValue([]);

  const response = await request(app).get(`/api/public/companies/${employerId}`);

  expect(response.status).toBe(200);
  expect(response.body.data.jobs).toEqual([]);
  expect(response.body.data.statistics).toEqual({ jobsPosted: 0, applicants: 0, candidatesSelected: 0 });
});
