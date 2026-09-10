import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  employerProfile: { upsert: jest.fn() },
  job: { findMany: jest.fn() },
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
const profileId = '33333333-3333-4333-8333-333333333333';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const profile = (overrides = {}) => ({
  id: profileId,
  companyName: 'Example Ltd',
  companyDescription: 'A real company description.',
  website: 'https://example.com',
  industry: 'Technology',
  companySize: '11-50 employees',
  location: 'Lagos, Nigeria',
  companyLogoUrl: null,
  ...overrides,
});

const user = (employerProfile = profile()) => ({
  email: 'employer@example.com',
  employerProfile,
});

const jobRecord = (companyProfile = profile()) => ({
  id: jobId,
  employerId: employerA,
  title: 'Engineer',
  description: 'Build products.',
  location: 'Lagos',
  department: null,
  workArrangement: 'REMOTE',
  engagementType: 'MONTHLY',
  jobType: 'NORMAL_EMPLOYMENT',
  skills: [],
  requirements: [],
  responsibilities: [],
  benefits: [],
  status: 'PENDING',
  applicationDeadline: null,
  rejectionReason: null,
  reviewedAt: null,
  closedAt: null,
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  employer: { employerProfile: companyProfile },
  employmentCompensation: null,
  contractCompensation: null,
  freelanceCompensation: null,
  _count: { applications: 0 },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(user());
  mockPrisma.employerProfile.upsert.mockResolvedValue(profile());
  mockPrisma.job.findMany.mockResolvedValue([]);
});

describe('Employer Profile authentication and authorization', () => {
  test.each(['GET', 'PATCH'])('unauthenticated %s is rejected', async (method) => {
    const response = await request(app)[method === 'GET' ? 'get' : 'patch']('/api/employer/profile').send({ companyName: 'Attempt' });
    expect(response.status).toBe(401);
  });

  test.each(['SEEKER', 'ADMIN'])('%s cannot access employer profile management', async (role) => {
    const getResponse = await request(app).get('/api/employer/profile').set('Authorization', `Bearer ${token(role, employerA)}`);
    const patchResponse = await request(app).patch('/api/employer/profile').set('Authorization', `Bearer ${token(role, employerA)}`).send({ companyName: 'Attempt' });
    expect(getResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
  });

  test('Employer A reads only the profile selected by the authenticated subject', async () => {
    const response = await request(app)
      .get(`/api/employer/profile?userId=${employerB}&employerId=${employerB}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.profile.companyName).toBe('Example Ltd');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: employerA } }));
  });

  test('Employer B receives only Employer B profile data despite Employer A identity overrides', async () => {
    mockPrisma.user.findUnique.mockImplementation(async ({ where: { id } }) => id === employerB
      ? user(profile({ companyName: 'Company B', location: 'Abuja, Nigeria' }))
      : user(profile({ companyName: 'Company A', location: 'Lagos, Nigeria' })));

    const response = await request(app)
      .get(`/api/employer/profile?userId=${employerA}&employerId=${employerA}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerB)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.profile).toMatchObject({ companyName: 'Company B', location: 'Abuja, Nigeria' });
    expect(response.body.data.profile.companyName).not.toBe('Company A');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: employerB } }));
  });

  test('client identity and role fields are rejected instead of trusted', async () => {
    const response = await request(app)
      .patch('/api/employer/profile?userId=' + employerB + '&employerId=' + employerB)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ companyName: 'Attempt', userId: employerB, employerId: employerB, role: 'ADMIN' });

    expect(response.status).toBe(400);
    expect(mockPrisma.employerProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('Employer Profile lifecycle and validation', () => {
  test('missing profile GET returns profile null and account email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user(null));

    const response = await request(app)
      .get('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ profile: null, account: { email: 'employer@example.com' } });
  });

  test('PATCH creates a missing profile using authenticated userId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user(null));
    mockPrisma.employerProfile.upsert.mockResolvedValue(profile({ companyName: 'Created Ltd' }));

    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ companyName: 'Created Ltd', location: 'Abuja' });

    expect(response.status).toBe(200);
    expect(mockPrisma.employerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: employerA },
      create: expect.objectContaining({ userId: employerA, companyName: 'Created Ltd' }),
    }));
  });

  test('PATCH refuses to create a missing profile without companyName', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(user(null));

    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ location: 'Abuja' });

    expect(response.status).toBe(400);
    expect(mockPrisma.employerProfile.upsert).not.toHaveBeenCalled();
  });

  test('PATCH updates an existing profile and preserves omitted fields', async () => {
    mockPrisma.employerProfile.upsert.mockResolvedValue(profile({ companyName: 'Updated Ltd' }));

    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ companyName: 'Updated Ltd' });

    expect(response.status).toBe(200);
    expect(mockPrisma.employerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { companyName: 'Updated Ltd' },
    }));
  });

  test('nullable fields can be cleared and empty website becomes null', async () => {
    mockPrisma.employerProfile.upsert.mockResolvedValue(profile({ companyDescription: null, website: null }));

    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ companyDescription: null, website: '' });

    expect(response.status).toBe(200);
    expect(mockPrisma.employerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { companyDescription: null, website: null } }));
  });

  test.each([
    [{ companyName: '' }, 'companyName'],
    [{ website: 'not-a-url' }, 'website'],
    [{ companyDescription: 'x'.repeat(5001) }, 'companyDescription'],
    [{ industry: 'x'.repeat(121) }, 'industry'],
    [{ companySize: 'x'.repeat(101) }, 'companySize'],
    [{ location: 'x'.repeat(161) }, 'location'],
  ])('rejects invalid profile input %p', async (body) => {
    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(mockPrisma.employerProfile.upsert).not.toHaveBeenCalled();
  });

  test.each(['userId', 'employerId', 'role', 'email', 'password', 'passwordHash', 'id', 'createdAt', 'updatedAt', 'companyLogoUrl', 'companyLogoKey'])('rejects forbidden field %s', async (field) => {
    const response = await request(app)
      .patch('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ companyName: 'Example Ltd', [field]: 'attacker-value' });

    expect(response.status).toBe(400);
    expect(mockPrisma.employerProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('Employer Profile privacy and cross-feature projection', () => {
  test('profile responses expose only safe company and account email fields', async () => {
    const response = await request(app)
      .get('/api/employer/profile')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('role');
    expect(response.body.data.profile).not.toHaveProperty('companyLogoKey');
    expect(response.body.data.profile).not.toHaveProperty('wallet');
    expect(response.body.data.profile).not.toHaveProperty('payments');
    expect(response.body.data.profile).not.toHaveProperty('withdrawals');
    expect(response.body.data.profile).not.toHaveProperty('ledger');
  });

  test('updated company fields remain available to the existing employer job projection', async () => {
    mockPrisma.job.findMany.mockResolvedValue([jobRecord(profile({ companyName: 'Updated Ltd', companyDescription: 'Updated description' }))]);

    const response = await request(app)
      .get('/api/employer/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs[0].company).toMatchObject({ name: 'Updated Ltd', description: 'Updated description' });
  });
});
