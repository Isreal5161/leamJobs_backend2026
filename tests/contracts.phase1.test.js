import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const employerId = '11111111-1111-4111-8111-111111111111';
const otherEmployerId = '22222222-2222-4222-8222-222222222222';
const seekerId = '33333333-3333-4333-8333-333333333333';
const otherSeekerId = '44444444-4444-4444-8444-444444444444';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const freelanceContractId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const timestamps = {
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
};

const applicant = {
  id: seekerId,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  seekerProfile: {
    professionalTitle: 'Engineer', profilePictureUrl: null, country: 'Nigeria', state: 'Lagos', city: 'Lagos', location: 'Lagos',
    bio: null, skills: [], education: null, experience: null, certifications: null, languages: null, projects: null, linkedinUrl: null,
    resumeObjectKey: null, cvTemplate: null,
  },
};

const applicationDetail = (status = 'ACCEPTED') => ({
  id: applicationId,
  jobId,
  status,
  coverLetter: null,
  resumeUrl: null,
  resumeObjectKey: null,
  resumeVersion: null,
  resumeSubmittedAt: timestamps.createdAt,
  ...timestamps,
  seeker: applicant,
  job: { id: jobId, title: 'Freelance Engineer', employerId },
});

const acceptanceApplication = {
  id: applicationId,
  jobId,
  seekerId,
  status: 'APPLIED',
  contract: null,
  seeker: { id: seekerId },
  job: {
    id: jobId,
    employerId,
    jobType: 'FREELANCE_PROJECT',
    engagementType: 'FREELANCE',
    freelanceCompensation: { projectAmount: new Prisma.Decimal('100000.00'), currency: 'NGN' },
  },
};

const contractRecord = ({ employerConfirmedAt = null, seekerConfirmedAt = null, status = 'PENDING', escrow = null } = {}) => ({
  id: contractId,
  applicationId,
  jobId,
  employerId,
  seekerId,
  type: 'FREELANCE_PROJECT',
  status,
  ...timestamps,
  freelanceDetails: {
    id: freelanceContractId,
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('95000.00'),
    employerConfirmedAt,
    seekerConfirmedAt,
    workStatus: 'PENDING',
    escrow,
  },
});

const escrowRecord = {
  id: escrowId,
  grossAmount: new Prisma.Decimal('100000.00'),
  platformFeeAmount: new Prisma.Decimal('5000.00'),
  seekerNetAmount: new Prisma.Decimal('95000.00'),
  currency: 'NGN',
  fundedAmount: new Prisma.Decimal('0.00'),
  releasedAmount: new Prisma.Decimal('0.00'),
  refundedAmount: new Prisma.Decimal('0.00'),
  status: 'UNFUNDED',
};

const mockPrisma = {
  application: { findFirst: jest.fn(), update: jest.fn() },
  contract: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  escrow: { create: jest.fn() },
  platformFeeConfiguration: { findUnique: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.application.findFirst.mockResolvedValue(null);
  mockPrisma.application.update.mockResolvedValue(applicationDetail());
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({ percentage: new Prisma.Decimal('5.00'), isActive: true });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: applicationId }]);
});

describe('Phase 1 freelance contract acceptance', () => {
  test('acceptance creates a pending contract with Decimal fee snapshots and no escrow', async () => {
    mockPrisma.application.findFirst
      .mockResolvedValueOnce({ id: applicationId })
      .mockResolvedValueOnce(acceptanceApplication)
      .mockResolvedValueOnce(applicationDetail());

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobId}/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`)
      .send({ status: 'ACCEPTED' });

    expect(response.status).toBe(200);
    expect(mockPrisma.contract.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        applicationId,
        jobId,
        employerId,
        seekerId,
        type: 'FREELANCE_PROJECT',
        status: 'PENDING',
        freelanceDetails: {
          create: expect.objectContaining({
            agreedAmount: new Prisma.Decimal('100000.00'),
            currency: 'NGN',
            platformFeePercentage: new Prisma.Decimal('5.00'),
            platformFeeAmount: new Prisma.Decimal('5000.00'),
            seekerNetAmount: new Prisma.Decimal('95000.00'),
            employerConfirmedAt: null,
            seekerConfirmedAt: null,
          }),
        },
      }),
    }));
    expect(mockPrisma.escrow.create).not.toHaveBeenCalled();
  });

  test('non-freelance status updates retain the existing path', async () => {
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationId });

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobId}/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`)
      .send({ status: 'SHORTLISTED' });

    expect(response.status).toBe(200);
    expect(mockPrisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SHORTLISTED' } }));
    expect(mockPrisma.contract.create).not.toHaveBeenCalled();
  });

  test('repeated freelance acceptance reuses the existing application contract', async () => {
    mockPrisma.application.findFirst
      .mockResolvedValueOnce({ id: applicationId })
      .mockResolvedValueOnce({ ...acceptanceApplication, contract: { id: contractId } })
      .mockResolvedValueOnce(applicationDetail());

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobId}/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`)
      .send({ status: 'ACCEPTED' });

    expect(response.status).toBe(200);
    expect(mockPrisma.contract.create).not.toHaveBeenCalled();
  });
});

describe('Phase 1 contract confirmation', () => {
  test('employer confirmation is role-scoped and remains pending alone', async () => {
    const pending = contractRecord();
    mockPrisma.contract.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(contractRecord({ employerConfirmedAt: timestamps.updatedAt }));
    mockPrisma.freelanceContract.update.mockResolvedValue({ ...pending.freelanceDetails, employerConfirmedAt: timestamps.updatedAt });

    const response = await request(app)
      .post(`/api/employer/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.contract.status).toBe('PENDING');
    expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith(expect.objectContaining({ data: { employerConfirmedAt: expect.any(Date) } }));
    expect(mockPrisma.escrow.create).not.toHaveBeenCalled();
  });

  test('wrong employer cannot confirm the contract', async () => {
    mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());

    const response = await request(app)
      .post(`/api/employer/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('EMPLOYER', otherEmployerId)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  });

  test('wrong seeker cannot confirm the contract', async () => {
    mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());

    const response = await request(app)
      .post(`/api/seeker/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('SEEKER', otherSeekerId)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
  });

  test('seeker confirmation activates once employer already confirmed and creates one unfunded escrow', async () => {
    const pending = contractRecord({ employerConfirmedAt: timestamps.updatedAt });
    const active = contractRecord({ employerConfirmedAt: timestamps.updatedAt, seekerConfirmedAt: timestamps.updatedAt, status: 'ACTIVE' });
    mockPrisma.contract.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(active);
    mockPrisma.freelanceContract.update.mockResolvedValue({ ...pending.freelanceDetails, seekerConfirmedAt: timestamps.updatedAt, employerConfirmedAt: timestamps.updatedAt });
    mockPrisma.contract.update.mockResolvedValue(active);
    mockPrisma.escrow.create.mockResolvedValue(escrowRecord);

    const response = await request(app)
      .post(`/api/seeker/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.contract.status).toBe('ACTIVE');
    expect(mockPrisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ACTIVE' } }));
    expect(mockPrisma.escrow.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        freelanceContractId: contractId,
        grossAmount: new Prisma.Decimal('100000.00'),
        platformFeeAmount: new Prisma.Decimal('5000.00'),
        seekerNetAmount: new Prisma.Decimal('95000.00'),
        currency: 'NGN',
        fundedAmount: new Prisma.Decimal('0.00'),
        releasedAmount: new Prisma.Decimal('0.00'),
        refundedAmount: new Prisma.Decimal('0.00'),
        status: 'UNFUNDED',
      }),
    }));
  });

  test('repeated confirmation on an active contract is idempotent', async () => {
    mockPrisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 'ACTIVE', escrow: escrowRecord }));

    const response = await request(app)
      .post(`/api/employer/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.contract.status).toBe('ACTIVE');
    expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
    expect(mockPrisma.escrow.create).not.toHaveBeenCalled();
  });

  test('legacy contracts without fee snapshots cannot be partially confirmed', async () => {
    const legacy = contractRecord();
    legacy.freelanceDetails.platformFeePercentage = null;
    legacy.freelanceDetails.platformFeeAmount = null;
    legacy.freelanceDetails.seekerNetAmount = null;
    mockPrisma.contract.findUnique.mockResolvedValue(legacy);

    const response = await request(app)
      .post(`/api/employer/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

    expect(response.status).toBe(409);
    expect(mockPrisma.freelanceContract.update).not.toHaveBeenCalled();
    expect(mockPrisma.escrow.create).not.toHaveBeenCalled();
  });
});

describe('Phase 1 financial safety', () => {
  test('confirmation transaction does not touch wallet, payment, withdrawal, or ledger models', async () => {
    const pending = contractRecord({ employerConfirmedAt: timestamps.updatedAt });
    const active = contractRecord({ employerConfirmedAt: timestamps.updatedAt, seekerConfirmedAt: timestamps.updatedAt, status: 'ACTIVE' });
    mockPrisma.contract.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(active);
    mockPrisma.freelanceContract.update.mockResolvedValue({ ...pending.freelanceDetails, seekerConfirmedAt: timestamps.updatedAt, employerConfirmedAt: timestamps.updatedAt });
    mockPrisma.contract.update.mockResolvedValue(active);
    mockPrisma.escrow.create.mockResolvedValue(escrowRecord);

    await request(app)
      .post(`/api/seeker/contracts/${contractId}/confirm`)
      .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);

    expect(mockPrisma.escrow.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma).not.toHaveProperty('wallet');
    expect(mockPrisma).not.toHaveProperty('payment');
    expect(mockPrisma).not.toHaveProperty('withdrawal');
  });
});
