import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  job: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  application: {
    count: jest.fn(),
  },
  contract: {
    count: jest.fn(),
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
const adminId = '99999999-9999-4999-8999-999999999999';
const jobA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
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
  reviewedById: null,
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
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.job.findMany.mockResolvedValue([]);
  mockPrisma.job.findFirst.mockResolvedValue(null);
  mockPrisma.job.findUnique.mockResolvedValue(null);
  mockPrisma.job.update.mockResolvedValue(null);
  mockPrisma.job.create.mockResolvedValue(null);
  mockPrisma.application.count.mockResolvedValue(0);
  mockPrisma.contract.count.mockResolvedValue(0);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    employmentCompensation: mockPrisma.employmentCompensation,
    contractCompensation: mockPrisma.contractCompensation,
    freelanceCompensation: mockPrisma.freelanceCompensation,
    job: { update: mockPrisma.job.update },
  }));
});

describe('Admin job creation and editing', () => {
  test('rejects unauthenticated POST /api/admin/jobs', async () => {
    const response = await request(app)
      .post('/api/admin/jobs')
      .send({
        title: 'Ops Manager',
        description: 'Run the business.',
        location: 'Lagos',
        engagementType: 'MONTHLY',
        jobType: 'NORMAL_EMPLOYMENT',
        requirements: ['Leadership'],
        responsibilities: ['Coordinate teams'],
        skills: ['Operations'],
        benefits: ['Bonus'],
        monthlyCompensation: { salaryMin: 200000, salaryMax: 300000, currency: 'NGN' },
        employerId: employerA,
      });

    expect(response.status).toBe(401);
  });

  test('rejects non-admin POST /api/admin/jobs', async () => {
    const response = await request(app)
      .post('/api/admin/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({
        title: 'Ops Manager',
        description: 'Run the business.',
        location: 'Lagos',
        engagementType: 'MONTHLY',
        jobType: 'NORMAL_EMPLOYMENT',
        requirements: ['Leadership'],
        responsibilities: ['Coordinate teams'],
        skills: ['Operations'],
        benefits: ['Bonus'],
        monthlyCompensation: { salaryMin: 200000, salaryMax: 300000, currency: 'NGN' },
        employerId: employerA,
      });

    expect(response.status).toBe(403);
  });

  test('rejects an invalid employer assignment when creating an admin job', async () => {
    const response = await request(app)
      .post('/api/admin/jobs')
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({
        title: 'Ops Manager',
        description: 'Run the business.',
        location: 'Lagos',
        engagementType: 'MONTHLY',
        jobType: 'NORMAL_EMPLOYMENT',
        requirements: ['Leadership'],
        responsibilities: ['Coordinate teams'],
        skills: ['Operations'],
        benefits: ['Bonus'],
        monthlyCompensation: { salaryMin: 200000, salaryMax: 300000, currency: 'NGN' },
        employerId: 'not-a-real-employer',
      });

    expect(response.status).toBe(400);
    expect(mockPrisma.job.create).not.toHaveBeenCalled();
  });

  test('creates an approved admin-owned job for a valid employer', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: employerA,
      role: 'EMPLOYER',
      employerProfile: { id: 'profile-1' },
    });
    mockPrisma.job.create.mockImplementation(async ({ data }) => ({
      id: jobA,
      employerId: employerA,
      title: data.title,
      description: data.description,
      location: data.location,
      department: data.department,
      workArrangement: data.workArrangement,
      engagementType: data.engagementType,
      jobType: data.jobType,
      skills: data.skills,
      requirements: data.requirements,
      responsibilities: data.responsibilities,
      benefits: data.benefits,
      status: data.status,
      applicationDeadline: data.applicationDeadline,
      rejectionReason: null,
      reviewedById: data.reviewedById,
      reviewedAt: data.reviewedAt,
      closedAt: null,
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
      employer: { employerProfile: { companyName: 'Employer A', companyDescription: 'Real company', website: 'https://example.com', industry: 'Technology', location: 'Lagos', companyLogoUrl: null } },
      employmentCompensation: data.employmentCompensation.create,
      contractCompensation: null,
      freelanceCompensation: null,
      _count: { applications: 0 },
    }));

    const response = await request(app)
      .post('/api/admin/jobs')
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({
        title: 'Ops Manager',
        description: 'Run the business.',
        location: 'Lagos',
        engagementType: 'MONTHLY',
        jobType: 'NORMAL_EMPLOYMENT',
        requirements: ['Leadership'],
        responsibilities: ['Coordinate teams'],
        skills: ['Operations'],
        benefits: ['Bonus'],
        monthlyCompensation: { salaryMin: 200000, salaryMax: 300000, currency: 'NGN' },
        employerId: employerA,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.job.status).toBe('APPROVED');
    expect(response.body.data.job.employerId).toBe(employerA);
    expect(response.body.data.job.reviewedById).toBe(adminId);
    expect(response.body.data.job.reviewedAt).toBeTruthy();
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: employerA },
    }));
  });

  test('updates an approved admin job without creating a duplicate row', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: employerA,
      role: 'EMPLOYER',
      employerProfile: { id: 'profile-1' },
    });
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ id: jobA, status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date('2026-09-11T00:00:00.000Z') }));
    mockPrisma.job.update.mockResolvedValue(jobRecord({
      id: jobA,
      title: 'Updated Ops Manager',
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date('2026-09-12T00:00:00.000Z'),
    }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({
        title: 'Updated Ops Manager',
        description: 'Run the business with better focus.',
        location: 'Abuja',
        department: 'Operations',
        workArrangement: 'HYBRID',
        engagementType: 'MONTHLY',
        jobType: 'NORMAL_EMPLOYMENT',
        requirements: ['Leadership'],
        responsibilities: ['Coordinate teams'],
        skills: ['Operations'],
        benefits: ['Bonus'],
        monthlyCompensation: { salaryMin: 250000, salaryMax: 350000, currency: 'NGN' },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.job.id).toBe(jobA);
    expect(response.body.data.job.status).toBe('APPROVED');
    expect(mockPrisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobA },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedById: adminId,
      }),
    }));
  });
});

describe('Admin job approval routes', () => {
  test('requires ADMIN role for admin job endpoints', async () => {
    const response = await request(app)
      .get('/api/admin/jobs')
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(403);
  });

  test('lists pending jobs for admins', async () => {
    mockPrisma.job.findMany.mockResolvedValue([jobRecord()]);

    const response = await request(app)
      .get('/api/admin/jobs?status=PENDING')
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.jobs).toHaveLength(1);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING' },
    }));
  });

  test('rejects an approval decision without a rejection reason when status is REJECTED', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord());

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/decision`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({ status: 'REJECTED' });

    expect(response.status).toBe(400);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test('approves a pending job and records the admin reviewer metadata', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord());
    mockPrisma.job.update.mockResolvedValue(jobRecord({
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date('2026-09-11T00:00:00.000Z'),
      rejectionReason: null,
    }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/decision`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({ status: 'APPROVED' });

    expect(response.status).toBe(200);
    expect(response.body.data.job.status).toBe('APPROVED');
    expect(mockPrisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobA },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedById: adminId,
        reviewedAt: expect.any(Date),
        rejectionReason: null,
      }),
    }));
  });

  test('blocks approving an already approved job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'APPROVED' }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/approve`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Cannot transition a job from APPROVED to APPROVED');
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test('blocks rejecting an already approved job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'APPROVED' }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/reject`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({ rejectionReason: 'not acceptable' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Cannot transition a job from APPROVED to REJECTED');
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test('blocks approving a rejected job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'REJECTED' }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/approve`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Cannot transition a job from REJECTED to APPROVED');
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test('blocks approving a closed job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'CLOSED' }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/approve`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Cannot transition a job from CLOSED to APPROVED');
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  test('blocks rejecting a closed job', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(jobRecord({ status: 'CLOSED' }));

    const response = await request(app)
      .patch(`/api/admin/jobs/${jobA}/reject`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({ rejectionReason: 'not acceptable' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Cannot transition a job from CLOSED to REJECTED');
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });
});
