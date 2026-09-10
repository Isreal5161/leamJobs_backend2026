import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.R2_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.R2_ACCESS_KEY_ID = 'test-key-id';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';

const mockPrisma = {
  application: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  job: { findFirst: jest.fn() },
  conversation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  message: { count: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
};

// Mock S3Client for R2
let mockSend;
jest.unstable_mockModule('@aws-sdk/client-s3', () => {
  mockSend = jest.fn();
  return {
    S3Client: jest.fn(() => ({
      send: mockSend,
    })),
    PutObjectCommand: jest.fn((input) => input),
    GetObjectCommand: jest.fn((input) => {
      // For GetObjectCommand, we'll resolve with the pdf-content as a stream
      return {
        ...input,
        __isGetObjectCommand: true,
      };
    }),
    DeleteObjectCommand: jest.fn((input) => input),
  };
});

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

// Now import storage functions
const { uploadObject, deleteObject } = await import('../src/services/storage/storage.service.js');

const employerA = '11111111-1111-4111-8111-111111111111';
const employerB = '22222222-2222-4222-8222-222222222222';
const jobA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const applicationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const seekerA = '33333333-3333-4333-8333-333333333333';
const conversationA = '44444444-4444-4444-8444-444444444444';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const profile = {
  professionalTitle: 'Frontend Engineer',
  profilePictureUrl: '/api/seeker/profile/picture',
  country: 'Nigeria', state: 'Lagos', city: 'Lagos', location: 'Lagos, Nigeria',
  bio: 'Builds accessible products.', skills: ['React', 'TypeScript'],
  education: [{ id: 'education-1', degree: 'BSc', school: 'University', year: '2024' }],
  experience: [{ id: 'experience-1', jobTitle: 'Engineer', company: 'Acme', description: 'Built products.' }],
  certifications: [{ id: 'certification-1', name: 'AWS', issuer: 'Amazon' }],
  languages: [{ id: 'language-1', name: 'English', proficiency: 'Fluent' }],
  projects: [{ id: 'project-1', name: 'Portfolio', description: 'A project' }],
  linkedinUrl: 'https://linkedin.com/in/example',
};

const seeker = { id: seekerA, firstName: 'Ada', lastName: 'Lovelace', seekerProfile: profile };
const detailApplication = (overrides = {}) => ({
  id: applicationA,
  jobId: jobA,
  status: 'APPLIED',
  coverLetter: 'I would love to contribute.',
  resumeUrl: null,
  resumeObjectKey: null,
  resumeVersion: null,
  resumeSubmittedAt: new Date('2026-09-10T10:00:00.000Z'),
  createdAt: new Date('2026-09-10T10:00:00.000Z'),
  updatedAt: new Date('2026-09-10T10:00:00.000Z'),
  seeker,
  job: { id: jobA, title: 'Frontend Engineer', employerId: employerA },
  ...overrides,
});

const conversation = (overrides = {}) => ({
  id: conversationA,
  seekerId: seekerA,
  employerId: employerA,
  jobId: jobA,
  applicationId: applicationA,
  seeker: { id: seekerA, firstName: 'Ada', lastName: 'Lovelace', seekerProfile: profile },
  employer: { id: employerA, firstName: 'Employer', lastName: 'A', employerProfile: { companyName: 'Employer A', companyLogoUrl: null } },
  job: { id: jobA, title: 'Frontend Engineer', location: 'Lagos', jobType: 'NORMAL_EMPLOYMENT' },
  application: { id: applicationA, status: 'APPLIED', jobId: jobA },
  messages: [],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.application.findMany.mockResolvedValue([]);
  mockPrisma.application.findFirst.mockResolvedValue(null);
  mockPrisma.application.findUnique.mockResolvedValue(null);
  mockPrisma.application.update.mockResolvedValue(detailApplication({ status: 'REVIEWING' }));
  mockPrisma.conversation.findMany.mockResolvedValue([]);
  mockPrisma.conversation.findFirst.mockResolvedValue(null);
  mockPrisma.conversation.findUnique.mockResolvedValue(null);
  mockPrisma.conversation.create.mockResolvedValue(conversation());
  mockPrisma.message.count.mockResolvedValue(0);
  mockPrisma.message.updateMany.mockResolvedValue({ count: 0 });

  // Reset S3 mock
  mockSend.mockReset();
  mockSend.mockImplementation((command) => {
    if (command.__isGetObjectCommand) {
      // Return a stream-like body for GetObjectCommand
      return Promise.resolve({
        Body: (async function* () {
          yield Buffer.from('pdf-content');
        })(),
      });
    }
    return Promise.resolve({});
  });
});

describe('Employer Applications authorization and privacy', () => {
  test('unauthenticated application requests are rejected', async () => {
    const response = await request(app).get(`/api/employer/jobs/${jobA}/applications`);
    expect(response.status).toBe(401);
  });

  test.each(['SEEKER', 'ADMIN'])('%s cannot access employer applications', async (role) => {
    const response = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications`)
      .set('Authorization', `Bearer ${token(role, seekerA)}`);
    expect(response.status).toBe(403);
  });

  test('Employer A list is scoped by the authenticated employer and excludes sensitive identity data', async () => {
    mockPrisma.application.findMany.mockResolvedValue([detailApplication()]);

    const response = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications?employerId=${employerB}&userId=${employerB}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.applications[0]).toMatchObject({ id: applicationA, jobId: jobA, status: 'APPLIED' });
    expect(response.body.data.applications[0].applicant).not.toHaveProperty('id');
    expect(response.body.data.applications[0].applicant).not.toHaveProperty('email');
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: jobA, job: { employerId: employerA } } }));
  });

  test('Employer B cannot access Employer A application detail', async () => {
    const response = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications/${applicationA}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerB)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: applicationA, jobId: jobA, job: { employerId: employerB } } }));
  });

  test('application detail exposes profile and application data but no unrelated sensitive fields', async () => {
    mockPrisma.application.findFirst.mockResolvedValue(detailApplication());

    const response = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications/${applicationA}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.application.applicant).toMatchObject({ fullName: 'Ada Lovelace', professionalTitle: 'Frontend Engineer', skills: ['React', 'TypeScript'] });
    expect(response.body.data.application).toHaveProperty('coverLetter');
    expect(response.body.data.application).not.toHaveProperty('passwordHash');
    expect(response.body.data.application).not.toHaveProperty('wallet');
    expect(response.body.data.application).not.toHaveProperty('email');
    expect(response.body.data.application).not.toHaveProperty('phone');
    expect(response.body.data.application).not.toHaveProperty('resumeObjectKey');
    expect(response.body.data.application.applicant.profilePictureUrl).toBeNull();
  });
});

describe('Employer Application status and CV access', () => {
  test('valid status updates only the status field after ownership validation', async () => {
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationA });
    mockPrisma.application.update.mockResolvedValue(detailApplication({ status: 'SHORTLISTED', updatedAt: new Date('2026-09-10T11:00:00.000Z') }));

    const response = await request(app)
      .patch(`/api/employer/jobs/${jobA}/applications/${applicationA}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ status: 'SHORTLISTED', jobId: jobB, seekerId: employerB });

    expect(response.status).toBe(400);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();

    const validResponse = await request(app)
      .patch(`/api/employer/jobs/${jobA}/applications/${applicationA}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ status: 'SHORTLISTED' });

    expect(validResponse.status).toBe(200);
    expect(mockPrisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: applicationA }, data: { status: 'SHORTLISTED' } }));
  });

  test('invalid status is rejected before database mutation', async () => {
    const response = await request(app)
      .patch(`/api/employer/jobs/${jobA}/applications/${applicationA}/status`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ status: 'NOT_A_STATUS' });

    expect(response.status).toBe(400);
    expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  test('unavailable application CV returns a clear 404 without exposing a storage key', async () => {
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationA, resumeObjectKey: null });

    const response = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications/${applicationA}/resume`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('CV not available for this application');
  });

  test('owning employer can access an application CV without receiving its storage key', async () => {
    const objectKey = `seekers/${seekerA}/resume/audit-${Date.now()}.pdf`;
    await uploadObject({ objectKey, buffer: Buffer.from('pdf-content') });
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationA, resumeObjectKey: objectKey });

    try {
      const response = await request(app)
        .get(`/api/employer/jobs/${jobA}/applications/${applicationA}/resume`)
        .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.body.toString()).toBe('pdf-content');
    } finally {
      await deleteObject(objectKey);
    }
  });

  test('another employer and a mismatched job cannot access an application CV', async () => {
    const otherEmployerResponse = await request(app)
      .get(`/api/employer/jobs/${jobA}/applications/${applicationA}/resume`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerB)}`);
    const mismatchedJobResponse = await request(app)
      .get(`/api/employer/jobs/${jobB}/applications/${applicationA}/resume`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(otherEmployerResponse.status).toBe(404);
    expect(mismatchedJobResponse.status).toBe(404);
  });
});

describe('Employer application conversations', () => {
  test('creates one application-linked conversation for the owning employer', async () => {
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationA, jobId: jobA, seekerId: seekerA });

    const response = await request(app)
      .post(`/api/employer/jobs/${jobA}/applications/${applicationA}/conversation`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { seekerId: seekerA, employerId: employerA, jobId: jobA, applicationId: applicationA },
    }));
  });

  test('another employer cannot create or access an application conversation', async () => {
    const response = await request(app)
      .post(`/api/employer/jobs/${jobA}/applications/${applicationA}/conversation`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerB)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('reuses an existing application conversation without creating a duplicate', async () => {
    mockPrisma.application.findFirst.mockResolvedValue({ id: applicationA, jobId: jobA, seekerId: seekerA });
    mockPrisma.conversation.findUnique.mockResolvedValue(conversation());

    const response = await request(app)
      .post(`/api/employer/jobs/${jobA}/applications/${applicationA}/conversation`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.conversation.id).toBe(conversationA);
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('rejects an application from another job even for the same employer', async () => {
    mockPrisma.application.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/employer/jobs/${jobA}/applications/${applicationA}/conversation`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('lists only conversations scoped to the authenticated employer', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([conversation()]);
    mockPrisma.message.count.mockResolvedValue(2);

    const response = await request(app)
      .get('/api/employer/conversations?employerId=' + employerB)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.conversations).toHaveLength(1);
    expect(response.body.data.conversations[0].seeker.profilePictureUrl).toBeNull();
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employerId: employerA } }));
  });

  test('cannot access another employer conversation', async () => {
    const response = await request(app)
      .get(`/api/employer/conversations/${conversationA}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerB)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: conversationA, employerId: employerB } }));
  });

  test('lists messages only from an employer-owned conversation', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: conversationA });
    mockPrisma.message.findMany.mockResolvedValue([{ id: 'message-1', conversationId: conversationA, senderId: employerA, body: 'Hello', clientMessageId: null, createdAt: new Date(), readAt: null }]);

    const response = await request(app)
      .get(`/api/employer/conversations/${conversationA}/messages`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.messages[0].body).toBe('Hello');
    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: conversationA, employerId: employerA } }));
  });

  test('rejects sender spoofing and derives sender from the authenticated employer', async () => {
    const spoofed = await request(app)
      .post(`/api/employer/conversations/${conversationA}/messages`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ body: 'Spoofed', senderId: seekerA });

    expect(spoofed.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();

    mockPrisma.conversation.findFirst.mockResolvedValue({ id: conversationA });
    const createdMessage = { id: 'message-2', conversationId: conversationA, senderId: employerA, body: 'Hello', clientMessageId: 'client-2', createdAt: new Date(), readAt: null };
    const transaction = {
      message: { create: jest.fn().mockResolvedValue(createdMessage) },
      conversation: { update: jest.fn().mockResolvedValue(conversation()) },
    };
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transaction));

    const response = await request(app)
      .post(`/api/employer/conversations/${conversationA}/messages`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ body: 'Hello', clientMessageId: 'client-2' });

    expect(response.status).toBe(201);
    expect(response.body.data.message.senderId).toBe(employerA);
    expect(transaction.message.create).toHaveBeenCalledWith({ data: { conversationId: conversationA, senderId: employerA, body: 'Hello', clientMessageId: 'client-2' } });
  });

  test('marks only an employer-owned conversation as read', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: conversationA });
    mockPrisma.message.count.mockResolvedValue(0);

    const response = await request(app)
      .patch(`/api/employer/conversations/${conversationA}/read`)
      .set('Authorization', `Bearer ${token('EMPLOYER', employerA)}`)
      .send({ employerId: employerB, seekerId: seekerA });

    expect(response.status).toBe(200);
    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: conversationA, senderId: { not: employerA }, readAt: null } }));
  });
});
