import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const leamJobsEmployerId = 'leamjobs-canonical-id';
const otherEmployerId = 'other-employer-id';
const adminId = 'admin-actor-id';
const jobId = 'job-for-leamjobs';
const otherJobId = 'job-for-other-employer';
const applicationId = 'application-1';
const otherApplicationId = 'application-2';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  employerProfile: {
    upsert: jest.fn(),
  },
  job: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  application: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  contract: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  escrow: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');
const { getLeamJobsEmployerIdentity } = await import('../src/services/leamjobsEmployer.service.js');

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const canonicalJob = () => ({
  id: jobId,
  employerId: leamJobsEmployerId,
  title: 'LeamJobs Panel Role',
  status: 'APPROVED',
  jobType: 'NORMAL_EMPLOYMENT',
  engagementType: 'CONTRACT',
  contractCompensation: { amount: 2000, currency: 'NGN', duration: '6 weeks', startMode: 'IMMEDIATE', scheduledStartDate: null, expectedCompletionDate: null },
});

const otherEmployerJob = () => ({
  id: otherJobId,
  employerId: otherEmployerId,
  title: 'Other Employer Role',
  status: 'APPROVED',
  jobType: 'NORMAL_EMPLOYMENT',
  engagementType: 'CONTRACT',
  contractCompensation: { amount: 2000, currency: 'NGN', duration: '6 weeks', startMode: 'IMMEDIATE', scheduledStartDate: null, expectedCompletionDate: null },
});

const listApplicationsPayload = [
  {
    id: applicationId,
    jobId,
    status: 'APPLIED',
    createdAt: new Date('2026-09-11T00:00:00.000Z'),
    updatedAt: new Date('2026-09-11T00:00:00.000Z'),
    contract: null,
    seeker: {
      id: 'seeker-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      seekerProfile: {
        professionalTitle: 'Engineer',
        profilePictureUrl: null,
        country: 'Nigeria',
        state: null,
        city: 'Lagos',
        location: 'Lagos',
        bio: null,
        skills: ['JS'],
        education: null,
        experience: null,
        certifications: null,
        languages: null,
        projects: null,
        linkedinUrl: null,
        resumeObjectKey: null,
        cvTemplate: null,
      },
    },
    job: {
      id: jobId,
      title: 'LeamJobs Panel Role',
      employerId: leamJobsEmployerId,
    },
  },
];

const detailApplication = {
  id: applicationId,
  jobId,
  status: 'APPLIED',
  coverLetter: 'Interested in this role.',
  resumeUrl: null,
  resumeObjectKey: null,
  resumeVersion: null,
  resumeSubmittedAt: new Date('2026-09-11T00:00:00.000Z'),
  createdAt: new Date('2026-09-11T00:00:00.000Z'),
  updatedAt: new Date('2026-09-11T00:00:00.000Z'),
  contract: null,
  seeker: {
    id: 'seeker-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    seekerProfile: {
      professionalTitle: 'Engineer',
      profilePictureUrl: null,
      country: 'Nigeria',
      state: null,
      city: 'Lagos',
      location: 'Lagos',
      bio: null,
      skills: ['JS'],
      education: null,
      experience: null,
      certifications: null,
      languages: null,
      projects: null,
      linkedinUrl: null,
      resumeObjectKey: null,
      cvTemplate: null,
    },
  },
  job: {
    id: jobId,
    title: 'LeamJobs Panel Role',
    employerId: leamJobsEmployerId,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({
    id: leamJobsEmployerId,
    role: 'EMPLOYER',
    employerProfile: { id: 'leamjobs-profile', companyName: 'LeamJobs' },
  });
  mockPrisma.employerProfile.upsert.mockResolvedValue({ id: 'leamjobs-profile', userId: leamJobsEmployerId, companyName: 'LeamJobs' });
  mockPrisma.job.findUnique.mockResolvedValue(null);
  mockPrisma.job.findFirst.mockResolvedValue(null);
  mockPrisma.application.findMany.mockResolvedValue([]);
  mockPrisma.application.findFirst.mockResolvedValue(null);
  mockPrisma.contract.findFirst.mockResolvedValue(null);
  mockPrisma.contract.create.mockResolvedValue({ id: 'contract-123' });
  mockPrisma.escrow.create.mockResolvedValue({ id: 'escrow-123', status: 'UNFUNDED' });
  mockPrisma.application.update.mockResolvedValue({ id: applicationId, status: 'PAYMENT_PENDING' });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    $queryRaw: jest.fn(),
    platformFeeConfiguration: {
      findUnique: jest.fn().mockResolvedValue({ percentage: '5.00', isActive: true }),
    },
    application: {
      findFirst: jest.fn().mockResolvedValue({
        id: applicationId,
        seekerId: 'seeker-1',
        status: 'APPLIED',
        contract: null,
        job: canonicalJob(),
      }),
      update: jest.fn().mockResolvedValue({ id: applicationId, status: 'PAYMENT_PENDING' }),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'contract-123' }),
    },
    escrow: {
      create: jest.fn().mockResolvedValue({ id: 'escrow-123', status: 'UNFUNDED' }),
    },
  }));
});

describe('Admin applicant authorization', () => {
  test('ADMIN can list applicants for a canonical LeamJobs job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    mockPrisma.application.findMany.mockResolvedValue(listApplicationsPayload);
    const response = await request(app)
      .get(`/api/admin/jobs/${jobId}/applications`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applications).toHaveLength(1);
    expect(response.body.data.applications[0].jobTitle).toBe('LeamJobs Panel Role');
  });

  test('ADMIN can view an applicant for a canonical LeamJobs job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    mockPrisma.application.findFirst.mockResolvedValue(detailApplication);
    const response = await request(app)
      .get(`/api/admin/jobs/${jobId}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.jobId).toBe(jobId);
    expect(response.body.data.application.applicant.email).toBe('ada@example.com');
  });

  test('ADMIN cannot list applicants for an unrelated employer job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(otherEmployerJob());
    const response = await request(app)
      .get(`/api/admin/jobs/${otherJobId}/applications`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(403);
  });

  test('ADMIN cannot view an applicant for an unrelated employer job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(otherEmployerJob());
    const response = await request(app)
      .get(`/api/admin/jobs/${otherJobId}/applications/${applicationId}`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(403);
  });

  test('ADMIN cannot access an application belonging to another job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    mockPrisma.application.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .get(`/api/admin/jobs/${jobId}/applications/${otherApplicationId}`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(404);
  });

  test('ADMIN cannot select a candidate for an unrelated employer job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(otherEmployerJob());
    const response = await request(app)
      .post(`/api/admin/jobs/${otherJobId}/applications/${applicationId}/select-contract`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({});

    expect(response.status).toBe(403);
  });

  test('ADMIN can select an eligible candidate for a canonical LeamJobs contract job', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    const txApplication = {
      id: applicationId,
      seekerId: 'seeker-1',
      status: 'APPLIED',
      contract: null,
      job: canonicalJob(),
    };
    const tx = {
      $queryRaw: jest.fn(),
      platformFeeConfiguration: {
        findUnique: jest.fn().mockResolvedValue({ percentage: '5.00', isActive: true }),
      },
      application: {
        findFirst: jest.fn().mockResolvedValue(txApplication),
        update: jest.fn().mockResolvedValue({ id: applicationId, status: 'PAYMENT_PENDING' }),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'contract-123' }),
      },
      escrow: {
        create: jest.fn().mockResolvedValue({ id: 'escrow-123', status: 'UNFUNDED' }),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));

    const response = await request(app)
      .post(`/api/admin/jobs/${jobId}/applications/${applicationId}/select-contract`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.selection.applicationId).toBe(applicationId);
    expect(response.body.data.selection.status).toBe('PAYMENT_PENDING');
  });

  test('Duplicate contract selection remains blocked for admin-managed LeamJobs jobs', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        $queryRaw: jest.fn(),
        platformFeeConfiguration: {
          findUnique: jest.fn().mockResolvedValue({ percentage: '5.00', isActive: true }),
        },
        application: {
          findFirst: jest.fn().mockResolvedValue({
            id: applicationId,
            seekerId: 'seeker-1',
            status: 'PAYMENT_PENDING',
            contract: { id: 'existing-contract' },
            job: canonicalJob(),
          }),
          update: jest.fn(),
        },
        contract: {
          findFirst: jest.fn().mockResolvedValue({ id: 'existing-contract' }),
          create: jest.fn(),
        },
        escrow: {
          create: jest.fn(),
        },
      };
      return callback(tx);
    });

    const response = await request(app)
      .post(`/api/admin/jobs/${jobId}/applications/${applicationId}/select-contract`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({});

    expect(response.status).toBe(409);
  });

  test('Existing EMPLOYER applicant routes still behave exactly as before', async () => {
    mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
    mockPrisma.application.findMany.mockResolvedValue(listApplicationsPayload);
    const response = await request(app)
      .get(`/api/employer/jobs/${jobId}/applications`)
      .set('Authorization', `Bearer ${token('EMPLOYER', leamJobsEmployerId)}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('Monthly employment does not accidentally create escrow via the Admin layer', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({ ...canonicalJob(), engagementType: 'MONTHLY', jobType: 'NORMAL_EMPLOYMENT' });
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        $queryRaw: jest.fn(),
        platformFeeConfiguration: {
          findUnique: jest.fn().mockResolvedValue({ percentage: '5.00', isActive: true }),
        },
        application: {
          findFirst: jest.fn().mockResolvedValue({
            id: applicationId,
            seekerId: 'seeker-1',
            status: 'APPLIED',
            contract: null,
            job: { ...canonicalJob(), engagementType: 'MONTHLY', jobType: 'NORMAL_EMPLOYMENT' },
          }),
          update: jest.fn(),
        },
        contract: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        escrow: {
          create: jest.fn(),
        },
      };
      return callback(tx);
    });

    const response = await request(app)
      .post(`/api/admin/jobs/${jobId}/applications/${applicationId}/select-contract`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
      .send({});

    expect(response.status).toBe(409);
    expect(mockPrisma.escrow.create).not.toHaveBeenCalled();
  });
});

test('admin actor ID is never used as the effective employer when selecting a contract', async () => {
  mockPrisma.job.findUnique.mockResolvedValue(canonicalJob());
  const tx = {
    $queryRaw: jest.fn(),
    platformFeeConfiguration: {
      findUnique: jest.fn().mockResolvedValue({ percentage: '5.00', isActive: true }),
    },
    application: {
      findFirst: jest.fn().mockResolvedValue({
        id: applicationId,
        seekerId: 'seeker-1',
        status: 'APPLIED',
        contract: null,
        job: canonicalJob(),
      }),
      update: jest.fn().mockResolvedValue({ id: applicationId, status: 'PAYMENT_PENDING' }),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'contract-123' }),
    },
    escrow: {
      create: jest.fn().mockResolvedValue({ id: 'escrow-123', status: 'UNFUNDED' }),
    },
  };
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));

  const response = await request(app)
    .post(`/api/admin/jobs/${jobId}/applications/${applicationId}/select-contract`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .send({});

  expect(response.status).toBe(200);
  expect(typeof response.body.data.selection).toBe('object');
  expect(tx.contract.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      employerId: leamJobsEmployerId,
    }),
  }));
  expect(tx.contract.create).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      employerId: adminId,
    }),
  }));
});
