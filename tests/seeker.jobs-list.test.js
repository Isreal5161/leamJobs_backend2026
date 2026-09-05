import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  job: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const createdAt = new Date('2026-09-05T12:00:00.000Z');
const jobId = '22222222-2222-4222-8222-222222222222';

const token = (role = 'SEEKER') => jwt.sign({ sub: seekerId, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const createJob = (overrides = {}) => ({
  id: jobId,
  title: 'Frontend Developer',
  description: 'Build React interfaces in Lagos.',
  location: 'Lagos',
  jobType: 'NORMAL_EMPLOYMENT',
  skills: ['React', 'TypeScript'],
  requirements: { experience: 'mid-level' },
  createdAt,
  applicationDeadline: null,
  employer: { employerProfile: {
    companyName: 'Example Ltd', companyDescription: 'Technology company', website: 'https://example.test', industry: 'Technology', companySize: '51-200', location: 'Lagos', companyLogoUrl: null,
  } },
  employmentCompensation: { salaryMin: { toString: () => '250000.00' }, salaryMax: { toString: () => '350000.00' }, currency: 'NGN', salaryPeriod: 'MONTHLY' },
  freelanceCompensation: null,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('GET /api/seeker/jobs', () => {
  test('lists approved jobs for an authenticated seeker with safe fields', async () => {
    mockPrisma.job.findMany.mockResolvedValue([createJob()]);

    const response = await request(app)
      .get('/api/seeker/jobs')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs[0]).toMatchObject({
      id: jobId,
      title: 'Frontend Developer',
      jobType: 'NORMAL_EMPLOYMENT',
      skills: ['React', 'TypeScript'],
      requirements: { experience: 'mid-level' },
      company: { name: 'Example Ltd' },
      compensation: { type: 'EMPLOYMENT', currency: 'NGN' },
    });
    expect(response.body.data.nextCursor).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('rejectionReason');
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'APPROVED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    }));
  });

  test('supports SQL-side search, location, job type, and skills filters', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/seeker/jobs?search=react&location=Lagos&jobType=NORMAL_EMPLOYMENT&skills=React,react,TypeScript&limit=10&userId=other')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();

    const validResponse = await request(app)
      .get('/api/seeker/jobs?search=react&location=Lagos&jobType=NORMAL_EMPLOYMENT&skills=React,react,TypeScript&limit=10')
      .set('Authorization', `Bearer ${token()}`);

    expect(validResponse.status).toBe(200);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'APPROVED',
        OR: [
          { title: { contains: 'react', mode: 'insensitive' } },
          { description: { contains: 'react', mode: 'insensitive' } },
          { location: { contains: 'react', mode: 'insensitive' } },
        ],
        location: { contains: 'Lagos', mode: 'insensitive' },
        jobType: 'NORMAL_EMPLOYMENT',
        skills: { hasSome: ['React', 'react', 'TypeScript'] },
      },
      take: 11,
    }));
  });

  test('uses deterministic cursor pagination', async () => {
    mockPrisma.job.findMany.mockResolvedValue([createJob({ id: '33333333-3333-4333-8333-333333333333' }), createJob({ id: '44444444-4444-4444-8444-444444444444' })]);

    const response = await request(app)
      .get('/api/seeker/jobs?limit=1&cursor=55555555-5555-4555-8555-555555555555')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { id: '55555555-5555-4555-8555-555555555555' },
      skip: 1,
      take: 2,
    }));
    expect(response.body.data.nextCursor).toBe('33333333-3333-4333-8333-333333333333');
  });

  test.each(['EMPLOYER', 'ADMIN'])('rejects %s role', async (role) => {
    const response = await request(app).get('/api/seeker/jobs').set('Authorization', `Bearer ${token(role)}`);
    expect(response.status).toBe(403);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated and malformed queries', async () => {
    const unauthenticated = await request(app).get('/api/seeker/jobs');
    const malformed = await request(app).get('/api/seeker/jobs?jobType=INVALID').set('Authorization', `Bearer ${token()}`);

    expect(unauthenticated.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });
});
