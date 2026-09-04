import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  application: { count: jest.fn(), findMany: jest.fn() },
  job: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const seekerId = 'seeker-a';
const createdAt = new Date('2026-09-04T12:00:00.000Z');

const createToken = (role, subject = seekerId) =>
  jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  });

const createProfile = (overrides = {}) => ({
  id: 'profile-a',
  professionalTitle: 'Frontend Developer',
  bio: 'Builds accessible interfaces.',
  location: 'Lagos',
  skills: ['React', 'TypeScript'],
  education: { degree: 'BSc' },
  experience: { years: 4 },
  resumeUrl: 'https://files.example/resume.pdf',
  resumeObjectKey: 'private/resume.pdf',
  profilePictureUrl: 'https://files.example/profile.jpg',
  profilePictureKey: 'private/profile.jpg',
  ...overrides,
});

const createUser = (overrides = {}) => ({
  id: seekerId,
  firstName: 'Jane',
  lastName: 'Doe',
  phone: '+2348000000000',
  seekerProfile: createProfile(),
  ...overrides,
});

const createJob = (overrides = {}) => ({
  id: 'job-a',
  title: 'Frontend Developer',
  description: 'Build product interfaces.',
  location: 'Lagos',
  jobType: 'NORMAL_EMPLOYMENT',
  createdAt,
  employer: {
    employerProfile: {
      companyName: 'Example Ltd',
      companyDescription: 'A technology company.',
      website: 'https://example.test',
      industry: 'Technology',
      companySize: '51-200',
      location: 'Lagos',
      companyLogoUrl: 'https://example.test/logo.png',
    },
  },
  employmentCompensation: {
    salaryMin: { toString: () => '250000.00' },
    salaryMax: { toString: () => '350000.00' },
    currency: 'NGN',
    salaryPeriod: 'MONTHLY',
  },
  freelanceCompensation: null,
  ...overrides,
});

const createApplication = (overrides = {}) => ({
  id: 'application-a',
  status: 'INTERVIEW',
  createdAt,
  job: {
    title: 'Frontend Developer',
    employer: { employerProfile: { companyName: 'Example Ltd' } },
  },
  ...overrides,
});

const configureDashboardData = ({ user = createUser(), jobs = [createJob()] } = {}) => {
  mockPrisma.user.findUnique.mockResolvedValue(user);
  mockPrisma.application.count.mockImplementation(({ where }) =>
    Promise.resolve(where.status === 'INTERVIEW' ? 2 : 7),
  );
  mockPrisma.application.findMany.mockResolvedValue([createApplication()]);
  mockPrisma.job.findMany.mockResolvedValue(jobs);
};

beforeEach(() => {
  jest.clearAllMocks();
  configureDashboardData();
});

describe('GET /api/seeker/dashboard', () => {
  test('returns 401 without an Authorization header', async () => {
    const response = await request(app).get('/api/seeker/dashboard');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Invalid authentication token' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('returns 401 for an invalid JWT', async () => {
    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  test.each(['EMPLOYER', 'ADMIN'])('returns 403 for a valid %s token', async (role) => {
    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken(role)}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('returns isolated seeker data and the approved response shape', async () => {
    const response = await request(app)
      .get('/api/seeker/dashboard?seekerId=seeker-b')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      profile: {
        id: 'profile-a',
        fullName: 'Jane Doe',
        profileCompletion: 100,
        resume: { url: 'https://files.example/resume.pdf' },
      },
      stats: { appliedJobs: 7, interviews: 2 },
    });
    expect(response.body.data).not.toHaveProperty('savedJobs');
    expect(response.body.data).not.toHaveProperty('recommendationScore');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: seekerId },
    }));
    expect(mockPrisma.application.count).toHaveBeenCalledWith({ where: { seekerId } });
    expect(mockPrisma.application.count).toHaveBeenCalledWith({
      where: { seekerId, status: 'INTERVIEW' },
    });
  });

  test('calculates profile completion from the nine approved fields', async () => {
    configureDashboardData({
      user: createUser({
        phone: null,
        seekerProfile: createProfile({
          bio: null,
        }),
      }),
    });

    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.body.data.profile.profileCompletion).toBe(78);
  });

  test('handles missing seeker profile and missing resume', async () => {
    configureDashboardData({ user: createUser({ seekerProfile: null }) });

    const missingProfileResponse = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(missingProfileResponse.status).toBe(200);
    expect(missingProfileResponse.body.data.profile).toBeNull();

    configureDashboardData({
      user: createUser({ seekerProfile: createProfile({ resumeUrl: null, resumeObjectKey: null }) }),
    });

    const missingResumeResponse = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(missingResumeResponse.status).toBe(200);
    expect(missingResumeResponse.body.data.profile.resume).toBeNull();
  });

  test('returns recent applications in descending creation order with a limit of five', async () => {
    configureDashboardData();

    await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { seekerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }));
  });

  test('returns only approved jobs in descending creation order with a limit of ten', async () => {
    configureDashboardData({
      jobs: [
        createJob({ id: 'new-job', createdAt: new Date('2026-09-04T13:00:00.000Z') }),
        createJob({ id: 'old-job' }),
      ],
    });

    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }));
    expect(response.body.data.approvedJobs).toHaveLength(2);
  });

  test('maps employment, freelance, and missing compensation', async () => {
    const responseData = [
      createJob(),
      createJob({
        id: 'job-b',
        jobType: 'FREELANCE_PROJECT',
        employmentCompensation: null,
        freelanceCompensation: {
          projectAmount: { toString: () => '500000.00' },
          currency: 'NGN',
        },
      }),
      createJob({
        id: 'job-c',
        employmentCompensation: null,
      }),
    ];
    configureDashboardData({ jobs: responseData });

    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.body.data.approvedJobs[0].compensation).toEqual({
      type: 'EMPLOYMENT',
      salaryMin: '250000.00',
      salaryMax: '350000.00',
      currency: 'NGN',
      salaryPeriod: 'MONTHLY',
    });
    expect(response.body.data.approvedJobs[1].compensation).toEqual({
      type: 'FREELANCE',
      projectAmount: '500000.00',
      currency: 'NGN',
    });
    expect(response.body.data.approvedJobs[2].compensation).toBeNull();
  });

  test('handles a missing employer profile', async () => {
    configureDashboardData({
      jobs: [createJob({ employer: { employerProfile: null } })],
    });

    const response = await request(app)
      .get('/api/seeker/dashboard')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.body.data.approvedJobs[0].company).toBeNull();
  });
});
