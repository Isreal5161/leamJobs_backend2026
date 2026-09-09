import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  job: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  application: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const createToken = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const createJob = (id, title) => ({
  id,
  title,
  location: 'Lagos',
  jobType: 'NORMAL_EMPLOYMENT',
  status: 'APPROVED',
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  _count: { applications: 2 },
});

const createApplication = (id, name, title) => ({
  id,
  status: 'APPLIED',
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  seeker: { firstName: name, lastName: 'Seeker' },
  job: { title },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.job.count.mockResolvedValue(0);
  mockPrisma.application.count.mockResolvedValue(0);
  mockPrisma.job.findMany.mockResolvedValue([]);
  mockPrisma.application.findMany.mockResolvedValue([]);
});

describe('GET /api/employer/dashboard', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const response = await request(app).get('/api/employer/dashboard');

    expect(response.status).toBe(401);
  });

  test('rejects a SEEKER token with 403', async () => {
    const response = await request(app)
      .get('/api/employer/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER', 'seeker-1')}`);

    expect(response.status).toBe(403);
  });

  test('rejects an ADMIN token with 403', async () => {
    const response = await request(app)
      .get('/api/employer/dashboard')
      .set('Authorization', `Bearer ${createToken('ADMIN', 'admin-1')}`);

    expect(response.status).toBe(403);
  });

  test('allows an EMPLOYER token and returns database-derived dashboard data', async () => {
    mockPrisma.job.count.mockResolvedValue(2);
    mockPrisma.application.count.mockImplementation(({ where }) => Promise.resolve(
      where.status === 'APPLIED' ? 3 : where.status === 'INTERVIEW' ? 1 : 0,
    ));
    mockPrisma.job.findMany.mockResolvedValue([createJob('job-a', 'Frontend Engineer')]);
    mockPrisma.application.findMany.mockResolvedValue([
      createApplication('application-a', 'Ada', 'Frontend Engineer'),
    ]);

    const response = await request(app)
      .get('/api/employer/dashboard')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'employer-a')}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        stats: {
          openRoles: 2,
          newApplicants: 3,
          interviews: 1,
          averageMatchScore: null,
        },
        pipeline: {
          applied: 3,
          interview: 1,
        },
        recentJobs: [{ id: 'job-a', title: 'Frontend Engineer', applicantCount: 2 }],
        recentApplications: [{ id: 'application-a', seekerName: 'Ada Seeker' }],
      },
    });
  });

  test('scopes all dashboard queries to the authenticated employer', async () => {
    mockPrisma.job.findMany.mockImplementation(({ where }) => Promise.resolve(
      where.employerId === 'employer-a' ? [createJob('job-a', 'Employer A Job')] : [createJob('job-b', 'Employer B Job')],
    ));
    mockPrisma.application.findMany.mockImplementation(({ where }) => Promise.resolve(
      where.job.employerId === 'employer-a'
        ? [createApplication('application-a', 'Ada', 'Employer A Job')]
        : [createApplication('application-b', 'Bea', 'Employer B Job')],
    ));

    const response = await request(app)
      .get('/api/employer/dashboard?userId=employer-b&employerId=employer-b&role=ADMIN')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'employer-a')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.recentJobs[0].id).toBe('job-a');
    expect(response.body.data.recentApplications[0].id).toBe('application-a');

    for (const call of mockPrisma.job.count.mock.calls) {
      expect(call[0].where.employerId).toBe('employer-a');
    }
    for (const call of mockPrisma.job.findMany.mock.calls) {
      expect(call[0].where.employerId).toBe('employer-a');
    }
    for (const call of mockPrisma.application.count.mock.calls) {
      expect(call[0].where.job.employerId).toBe('employer-a');
    }
    for (const call of mockPrisma.application.findMany.mock.calls) {
      expect(call[0].where.job.employerId).toBe('employer-a');
    }
  });

  test('returns real zero and empty values for an employer without activity', async () => {
    const response = await request(app)
      .get('/api/employer/dashboard')
      .set('Authorization', `Bearer ${createToken('EMPLOYER', 'new-employer')}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      stats: {
        openRoles: 0,
        newApplicants: 0,
        interviews: 0,
        averageMatchScore: null,
      },
      pipeline: {
        applied: 0,
        reviewing: 0,
        shortlisted: 0,
        interview: 0,
        accepted: 0,
      },
      recentJobs: [],
      recentApplications: [],
    });
  });
});
