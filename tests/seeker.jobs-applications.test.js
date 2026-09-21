import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  seekerProfile: { findUnique: jest.fn() },
  application: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  applicationCvSnapshot: { create: jest.fn() },
  subscription: { findFirst: jest.fn() },
  job: { findFirst: jest.fn() },
  $transaction: jest.fn(async (callback) => callback({
    application: mockPrisma.application,
    applicationCvSnapshot: mockPrisma.applicationCvSnapshot,
  })),
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-09-04T12:00:00.000Z');

const createToken = (role = 'SEEKER', subject = seekerId) =>
  jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  });

const company = {
  companyName: 'Example Ltd',
  companyDescription: 'A technology company.',
  website: 'https://example.test',
  industry: 'Technology',
  companySize: '51-200',
  location: 'Lagos',
  companyLogoUrl: 'https://example.test/logo.png',
};

const employmentCompensation = {
  salaryMin: { toString: () => '250000.00' },
  salaryMax: { toString: () => '350000.00' },
  currency: 'NGN',
  salaryPeriod: 'MONTHLY',
};

const createJob = (overrides = {}) => ({
  id: jobId,
  title: 'Frontend Developer',
  description: 'Build product interfaces.',
  location: 'Lagos',
  jobType: 'NORMAL_EMPLOYMENT',
  createdAt,
  applicationDeadline: null,
  employer: { employerProfile: company },
  employmentCompensation,
  freelanceCompensation: null,
  ...overrides,
});

const createApplication = (overrides = {}) => ({
  id: '44444444-4444-4444-8444-444444444444',
  jobId,
  status: 'APPLIED',
  createdAt,
  updatedAt: createdAt,
  job: {
    id: jobId,
    title: 'Frontend Developer',
    jobType: 'NORMAL_EMPLOYMENT',
    location: 'Lagos',
    employer: { employerProfile: { companyName: 'Example Ltd' } },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: seekerId,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+2348123456789',
  });
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({
    resumeUrl: 'https://files.example/resume.pdf',
    resumeObjectKey: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
    professionalTitle: 'Senior Product Designer',
    bio: 'Product designer with a passion for accessible experiences.',
    country: 'Nigeria',
    state: 'Lagos',
    city: 'Lekki',
    location: 'Lekki, Lagos, Nigeria',
    skills: ['UX Research', 'Figma', 'Design Systems'],
    education: [{ degree: 'BSc Computer Science', school: 'University of Lagos', year: '2014' }],
    experience: [{
      jobTitle: 'Senior Product Designer',
      company: 'LeamJobs',
      startDate: '2022-01',
      endDate: '2024-05',
      currentlyWorking: false,
      description: 'Led product design across multiple client workflows.',
    }],
    certifications: [{ name: 'Google UX Design', issuer: 'Google' }],
    languages: [{ name: 'English', proficiency: 'Native' }],
    projects: [{
      name: 'LeamJobs Platform',
      description: 'Design system for a hiring platform.',
      technologies: ['Figma', 'React'],
      projectUrl: 'https://example.com',
      githubUrl: 'https://github.com/example',
      startDate: '2023-01',
      endDate: '2023-12',
    }],
    linkedinUrl: 'https://linkedin.com/in/ada',
    cvTemplate: 'modern',
  });
});

describe('seeker job and application endpoints', () => {
  test('allows an authenticated seeker to retrieve an approved job with application state', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/seeker/jobs/${jobId}`)
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        alreadyApplied: false,
        job: {
          id: jobId,
          title: 'Frontend Developer',
          company: { name: 'Example Ltd' },
          compensation: { type: 'EMPLOYMENT', salaryMin: '250000.00' },
        },
      },
    });
    expect(mockPrisma.application.findUnique).toHaveBeenCalledWith({
      where: { seekerId_jobId: { seekerId, jobId } },
      select: { id: true },
    });
  });

  test('returns alreadyApplied true for the authenticated seeker only', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue({ id: 'application-id' });

    const response = await request(app)
      .get(`/api/seeker/jobs/${jobId}`)
      .set('Authorization', `Bearer ${createToken('SEEKER', otherSeekerId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.alreadyApplied).toBe(true);
    expect(mockPrisma.application.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { seekerId_jobId: { seekerId: otherSeekerId, jobId } },
    }));
  });

  test('returns 404 when the approved job is unavailable', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/seeker/jobs/${jobId}`)
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ message: 'Job not found', status: 404 });
  });

  test('lists only the authenticated seeker applications newest first with real interview count', async () => {
    mockPrisma.application.findMany.mockResolvedValue([createApplication()]);
    mockPrisma.application.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/seeker/applications?seekerId=someone-else')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toEqual({ total: 1, interviews: 1 });
    expect(response.body.data.applications[0]).toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      jobId,
      jobTitle: 'Frontend Developer',
      companyName: 'Example Ltd',
      status: 'APPLIED',
    });
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { seekerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    }));
    expect(mockPrisma.application.count).toHaveBeenCalledWith({
      where: { seekerId, status: 'INTERVIEW' },
    });
  });

  test('supports an empty application list', async () => {
    mockPrisma.application.findMany.mockResolvedValue([]);
    mockPrisma.application.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      applications: [],
      summary: { total: 0, interviews: 0 },
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    });
  });

  test('creates an application using the JWT seeker and safe request fields', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication({ status: 'APPLIED' }));

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.', resumeUrl: 'https://files.example/resume.pdf', seekerId: otherSeekerId, status: 'ACCEPTED' });

    expect(response.status).toBe(400);
    expect(mockPrisma.application.create).not.toHaveBeenCalled();
  });

  test('creates a valid application using the authenticated seeker profile CV snapshot and ignores client-controlled ownership fields', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication());

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { application: { id: '44444444-4444-4444-8444-444444444444', jobId } },
    });
    expect(mockPrisma.application.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        seekerId,
        jobId,
        coverLetter: 'I would love to contribute.',
        resumeUrl: 'https://files.example/resume.pdf',
        resumeObjectKey: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
        resumeVersion: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
        resumeSubmittedAt: expect.any(Date),
      },
    }));
  });

  test('uses the updated profile CV snapshot for a new application after a CV replacement', async () => {
    const cvB = {
      resumeUrl: 'https://files.example/resume-b.pdf',
      resumeObjectKey: `seekers/${seekerId}/resume/cv-b.pdf`,
    };
    mockPrisma.seekerProfile.findUnique.mockResolvedValue(cvB);
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication({
      resumeUrl: cvB.resumeUrl,
      resumeObjectKey: cvB.resumeObjectKey,
      resumeVersion: cvB.resumeObjectKey,
    }));

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.' });

    expect(response.status).toBe(201);
    expect(mockPrisma.application.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resumeUrl: cvB.resumeUrl,
        resumeObjectKey: cvB.resumeObjectKey,
        resumeVersion: cvB.resumeObjectKey,
      }),
    }));
  });

  test('uses the authenticated seeker profile uploaded CV and rejects client-supplied mismatched uploaded CV ownership', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication({
      resumeUrl: 'https://files.example/resume.pdf',
      resumeObjectKey: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
      resumeVersion: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
    }));

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({
        jobId,
        coverLetter: 'I would love to contribute.',
        cvSource: 'upload',
        resumeUrl: 'https://files.example/another-user.pdf',
        resumeObjectKey: 'seekers/22222222-2222-4222-8222-222222222222/resume/other-user.pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Uploaded CV does not belong to the authenticated seeker.');
    expect(mockPrisma.application.create).not.toHaveBeenCalled();

    const validUploadResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({
        jobId,
        coverLetter: 'I would love to contribute.',
        cvSource: 'upload',
      });

    expect(validUploadResponse.status).toBe(201);
    expect(mockPrisma.application.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resumeUrl: 'https://files.example/resume.pdf',
        resumeObjectKey: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
        resumeVersion: 'seekers/11111111-1111-4111-8111-111111111111/resume/current.pdf',
      }),
    }));
    expect(mockPrisma.applicationCvSnapshot.create).not.toHaveBeenCalled();
  });

  test('allows application creation without a saved CV when using the LeamJobs CV flow', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValue({
      resumeUrl: null,
      resumeObjectKey: null,
      professionalTitle: 'Product Designer',
      bio: 'Designs digital experiences.',
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Lekki',
      location: 'Lekki, Lagos, Nigeria',
      skills: ['Figma'],
      education: [],
      experience: [],
      certifications: [],
      languages: [],
      projects: [],
      linkedinUrl: 'https://linkedin.com/in/example',
      cvTemplate: 'modern',
    });
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication({
      resumeUrl: null,
      resumeObjectKey: null,
      resumeVersion: null,
    }));

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.', cvSource: 'template' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockPrisma.application.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        seekerId,
        jobId,
        coverLetter: 'I would love to contribute.',
        resumeUrl: null,
        resumeObjectKey: null,
        resumeVersion: null,
      }),
    }));
  });

  test('creates an immutable LeamJobs template CV snapshot from the authenticated profile', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockResolvedValue(createApplication({
      resumeUrl: null,
      resumeObjectKey: null,
      resumeVersion: null,
    }));
    mockPrisma.applicationCvSnapshot.create.mockResolvedValue({
      id: 'snapshot-1',
      applicationId: '44444444-4444-4444-8444-444444444444',
      source: 'LEAMJOBS_TEMPLATE',
      templateId: 'modern',
      templateName: 'Modern',
      snapshotCapturedAt: new Date(),
      snapshot: { personalInfo: { fullName: 'Ada Lovelace', title: 'Senior Product Designer', email: 'ada@example.com' } },
    });

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.', cvSource: 'template' });

    expect(response.status).toBe(201);
    expect(mockPrisma.applicationCvSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        applicationId: '44444444-4444-4444-8444-444444444444',
        source: 'LEAMJOBS_TEMPLATE',
        templateId: 'modern',
        templateName: 'modern',
        snapshot: expect.objectContaining({
          personalInfo: expect.objectContaining({
            fullName: 'Ada Lovelace',
            title: 'Senior Product Designer',
            email: 'ada@example.com',
          }),
        }),
      }),
    }));
  });

  test('does not allow a free seeker to use a saved advanced template for an application', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValue({
      resumeUrl: null,
      resumeObjectKey: null,
      professionalTitle: 'Senior Product Designer',
      bio: 'Designs digital experiences.',
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Lekki',
      location: 'Lekki, Lagos, Nigeria',
      skills: ['Figma'],
      education: [],
      experience: [],
      certifications: [],
      languages: [],
      projects: [],
      linkedinUrl: 'https://linkedin.com/in/example',
      cvTemplate: 'executive',
    });
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId, coverLetter: 'I would love to contribute.', cvSource: 'template' });

    expect(response.status).toBe(403);
    expect(mockPrisma.application.create).not.toHaveBeenCalled();
    expect(mockPrisma.applicationCvSnapshot.create).not.toHaveBeenCalled();
  });

  test('returns 404 for nonexistent, unapproved, or expired application jobs', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    const nonexistentResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId });

    expect(nonexistentResponse.status).toBe(404);

    mockPrisma.job.findFirst.mockResolvedValue(createJob({ applicationDeadline: new Date('2020-01-01T00:00:00.000Z') }));

    const expiredResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId });

    expect(expiredResponse.status).toBe(404);
    expect(mockPrisma.application.create).not.toHaveBeenCalled();
  });

  test('returns 409 for an existing or concurrent duplicate application', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(createJob());
    mockPrisma.application.findUnique.mockResolvedValue({ id: 'existing-application' });

    const existingResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId });

    expect(existingResponse.status).toBe(409);
    expect(existingResponse.body).toEqual({ message: 'You have already applied to this job', status: 409 });

    mockPrisma.application.findUnique.mockResolvedValue(null);
    mockPrisma.application.create.mockRejectedValue({ code: 'P2002' });

    const concurrentResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId });

    expect(concurrentResponse.status).toBe(409);
    expect(concurrentResponse.body).toEqual({ message: 'You have already applied to this job', status: 409 });
  });

  test('rejects invalid input and unauthorized roles', async () => {
    const invalidResponse = await request(app)
      .post('/api/seeker/applications')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ jobId: 'not-a-uuid', unknown: true });

    expect(invalidResponse.status).toBe(400);
    expect(mockPrisma.job.findFirst).not.toHaveBeenCalled();

    const employerResponse = await request(app)
      .get(`/api/seeker/jobs/${jobId}`)
      .set('Authorization', `Bearer ${createToken('EMPLOYER')}`);

    expect(employerResponse.status).toBe(403);
  });

  test('returns 401 without a token or with an invalid token', async () => {
    const noTokenResponse = await request(app).get('/api/seeker/applications');
    const invalidTokenResponse = await request(app)
      .get('/api/seeker/applications')
      .set('Authorization', 'Bearer invalid-token');

    expect(noTokenResponse.status).toBe(401);
    expect(invalidTokenResponse.status).toBe(401);
  });
});
