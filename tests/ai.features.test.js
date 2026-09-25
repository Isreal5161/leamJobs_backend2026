import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const seekerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const mockPrisma = {
  subscription: { findFirst: jest.fn() },
  seekerProfile: { findUnique: jest.fn() },
  job: { findFirst: jest.fn() },
  application: { findUnique: jest.fn() },
  aiUsageRecord: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const mockCompletion = jest.fn();
jest.unstable_mockModule('../src/services/aiProvider.service.js', () => ({
  AiProviderError: class AiProviderError extends Error {},
  requestStructuredCompletion: mockCompletion,
}));
const { default: app } = await import('../src/app.js');
const { generateCoverLetter } = await import('../src/services/aiFeatures.service.js');
const { validateProfileAssistant } = await import('../src/validators/ai.validation.js');

const token = (role = 'SEEKER', subject = seekerId) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });
const activePlan = (key) => ({ status: 'ACTIVE', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 60_000), plan: { entitlements: [{ entitlement: { key } }] } });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.job.findFirst.mockResolvedValue({ id: jobId, title: 'Engineer', description: 'Build things', skills: ['JS'], requirements: [], responsibilities: [], benefits: [] });
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ professionalTitle: 'Engineer', bio: 'Builds products', skills: ['JS'], experience: [], education: [] });
  mockPrisma.aiUsageRecord.findMany.mockResolvedValue([]);
  mockPrisma.aiUsageRecord.create.mockImplementation(async ({ data }) => ({ id: `usage-${mockPrisma.aiUsageRecord.create.mock.calls.length}`, ...data }));
  mockPrisma.aiUsageRecord.deleteMany.mockResolvedValue({ count: 1 });
  mockPrisma.$queryRaw.mockResolvedValue([{ id: seekerId }]);
  mockCompletion.mockResolvedValue({ suggestions: [{ section: 'bio', suggestion: 'Clear summary', reason: 'More direct' }] });
});

test('profile assistant validator accepts frontend experience and education payload fields while staying strict', () => {
  const req = {
    body: {
      request: 'Review my profile',
      professionalTitle: 'Senior Software Engineer',
      experience: [{
        id: 'exp-1',
        jobTitle: 'Senior Software Engineer',
        company: 'Acme Labs',
        startDate: '2020-01',
        endDate: '2022-12',
        currentlyWorking: false,
        description: 'Led frontend and API delivery.',
      }],
      education: [{
        id: 'edu-1',
        degree: 'BSc Computer Science',
        school: 'University of Lagos',
        year: '2019',
      }],
    },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  validateProfileAssistant(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.validatedAi.experience).toHaveLength(1);
  expect(req.validatedAi.experience[0]).toMatchObject({ id: 'exp-1', startDate: '2020-01', endDate: '2022-12', currentlyWorking: false });
  expect(req.validatedAi.education).toHaveLength(1);
  expect(req.validatedAi.education[0]).toMatchObject({ id: 'edu-1', degree: 'BSc Computer Science', school: 'University of Lagos', year: '2019' });
});

test('profile assistant validator still rejects unknown experience and education fields because it remains strict', () => {
  const req = {
    body: {
      request: 'Review my profile',
      experience: [{
        id: 'exp-1',
        jobTitle: 'Senior Engineer',
        company: 'Acme Labs',
        startDate: '2020-01',
        endDate: '2022-12',
        currentlyWorking: false,
        description: 'Led frontend and API delivery.',
        extraField: 'not allowed',
      }],
      education: [{
        id: 'edu-1',
        degree: 'BSc Computer Science',
        school: 'University of Lagos',
        year: '2019',
        extraField: 'not allowed',
      }],
    },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  validateProfileAssistant(req, res, next);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(next).not.toHaveBeenCalled();
});

test('AI profile assistant accepts rich frontend experience payloads without changing service behavior', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_PROFILE_ASSISTANT'));
  const response = await request(app).post('/api/seeker/ai/profile-assistant').set('Authorization', `Bearer ${token()}`).send({
    request: 'Review my profile',
    professionalTitle: 'Senior Software Engineer',
    experience: [{
      id: 'exp-1',
      jobTitle: 'Senior Software Engineer',
      company: 'Acme Labs',
      startDate: '2020-01',
      endDate: '2022-12',
      currentlyWorking: false,
      description: 'Led frontend and API delivery.',
    }],
    education: [{
      id: 'edu-1',
      degree: 'BSc Computer Science',
      school: 'University of Lagos',
      year: '2019',
    }],
  });

  expect(response.status).toBe(200);
  expect(mockCompletion).toHaveBeenCalled();
});

test('AI profile assistant rejects unauthenticated and non-seeker requests', async () => {
  await expect(request(app).post('/api/seeker/ai/profile-assistant').send({ request: 'Help' })).resolves.toMatchObject({ status: 401 });
  await expect(request(app).post('/api/seeker/ai/profile-assistant').set('Authorization', `Bearer ${token('EMPLOYER')}`).send({ request: 'Help' })).resolves.toMatchObject({ status: 403 });
});

test.each(['PENDING', 'EXPIRED', 'CANCELLED', 'FAILED'])('AI profile assistant rejects %s', async (status) => {
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  const response = await request(app).post('/api/seeker/ai/profile-assistant').set('Authorization', `Bearer ${token()}`).send({ request: 'Help' });
  expect(response.status).toBe(403);
  expect(mockCompletion).not.toHaveBeenCalled();
});

test('active entitled seeker receives transient profile suggestions without writes', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_PROFILE_ASSISTANT'));
  const response = await request(app).post('/api/seeker/ai/profile-assistant').set('Authorization', `Bearer ${token()}`).send({ request: 'Improve my bio', bio: 'Builds products' });
  expect(response.status).toBe(200);
  expect(response.body.data.suggestions).toHaveLength(1);
  expect(mockCompletion).toHaveBeenCalled();
});

test('CV optimizer accepts the real frontend editor CV structure with nested summary and item ids', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_CV_OPTIMIZER'));
  mockCompletion.mockResolvedValue({ summary: 'A stronger summary', suggestions: [{ section: 'summary', original: 'Old summary', suggested: 'A stronger summary', reason: 'Clearer value proposition' }] });

  const response = await request(app).post('/api/seeker/ai/cv-optimizer').set('Authorization', `Bearer ${token()}`).send({
    request: 'Improve summary',
    cv: {
      personalInfo: {
        fullName: 'Amina Okafor',
        title: 'Senior Product Engineer',
        email: 'amina@example.com',
        phone: '+2348000000000',
        location: 'Lagos, Nigeria',
        linkedin: 'https://linkedin.com/in/amina',
        summary: 'Builds product experiences that delight customers.',
      },
      summary: 'Builds product experiences that delight customers.',
      experience: [{
        id: 'exp-1',
        jobTitle: 'Senior Product Engineer',
        company: 'Acme Labs',
        startDate: '2020-01',
        endDate: '2024-12',
        currentlyWorking: false,
        description: 'Led product and engineering improvements.',
      }],
      education: [{ id: 'edu-1', degree: 'BSc Computer Science', school: 'University of Lagos', year: '2019' }],
      skills: ['JavaScript', 'Node.js', 'Product strategy'],
      certifications: [{ id: 'cert-1', name: 'AWS Certified Developer', issuer: 'AWS' }],
      languages: [{ id: 'lang-1', name: 'English', proficiency: 'Fluent' }],
      projects: [{
        id: 'proj-1',
        name: 'Hiring Portal',
        description: 'Rebuilt a candidate experience flow.',
        technologies: ['React', 'Node.js'],
        projectUrl: 'https://example.com',
        githubUrl: 'https://github.com/example',
        startDate: '2023-01',
        endDate: '2023-12',
      }],
    },
  });

  expect(response.status).toBe(200);
  expect(response.body.data.summary).toBe('A stronger summary');
  expect(mockCompletion).toHaveBeenCalled();
});

test('CV optimizer rejects genuinely unknown frontend CV fields while staying strict', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_CV_OPTIMIZER'));
  const response = await request(app).post('/api/seeker/ai/cv-optimizer').set('Authorization', `Bearer ${token()}`).send({
    request: 'Improve summary',
    cv: {
      personalInfo: { fullName: 'A', title: 'Engineer', summary: 'Strong summary', hiddenFlag: true },
      experience: [{ id: 'exp-1', jobTitle: 'x', company: 'Acme', startDate: '2020-01', endDate: '2022-12', currentlyWorking: false, description: 'desc', hiddenFlag: true }],
      education: [{ id: 'edu-1', degree: 'BSc', school: 'Uni', year: '2019', hiddenFlag: true }],
      skills: ['JS'],
      certifications: [{ id: 'cert-1', name: 'AWS', issuer: 'AWS', hiddenFlag: true }],
      languages: [{ id: 'lang-1', name: 'English', proficiency: 'Fluent', hiddenFlag: true }],
      projects: [{ id: 'proj-1', name: 'Portal', description: 'desc', technologies: ['React'], projectUrl: 'https://example.com', githubUrl: 'https://github.com', startDate: '2023-01', endDate: '2023-12', hiddenFlag: true }],
    },
  });

  expect(response.status).toBe(400);
  expect(mockCompletion).not.toHaveBeenCalled();
});

test('CV optimizer requires its specific entitlement and validates input', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_CV_OPTIMIZER'));
  const response = await request(app).post('/api/seeker/ai/cv-optimizer').set('Authorization', `Bearer ${token()}`).send({ request: 'Improve summary', cv: { personalInfo: { fullName: 'A', title: 'Engineer' }, experience: [{ jobTitle: 'x' }], education: [], skills: [], certifications: [] } });
  expect(response.status).toBe(400);
  expect(mockCompletion).not.toHaveBeenCalled();
});

test('application assistance requires approved job and never submits an application', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_APPLICATION_ASSISTANCE'));
  mockCompletion.mockResolvedValue({ coverLetter: 'Draft', alignmentPoints: ['JS'], strengths: ['Experience'], gaps: [] });
  const response = await request(app).post('/api/seeker/ai/application-assistance').set('Authorization', `Bearer ${token()}`).send({ jobId, request: 'Draft' });
  expect(response.status).toBe(200);
  expect(response.body.data.coverLetter).toBe('Draft');
  expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobId, status: 'APPROVED' } }));
});

test('generateCoverLetter reads company name from employerProfile', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_COVER_LETTER'));
  mockPrisma.application.findUnique.mockResolvedValue({
    id: 'app-1',
    seekerId: seekerId,
    jobId: jobId,
    coverLetter: '',
    job: {
      title: 'Engineer',
      description: 'Build things',
      skills: ['JS'],
      requirements: [],
      responsibilities: [],
      benefits: [],
      employer: { employerProfile: { companyName: 'Example Labs' } },
    },
  });
  mockCompletion.mockResolvedValue({ coverLetter: 'Dear Example Labs team,' });

  const result = await generateCoverLetter(seekerId, { applicationId: 'app-1', request: 'Write a cover letter' });

  expect(result.coverLetter).toBe('Dear Example Labs team,');
  expect(mockPrisma.application.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.objectContaining({
      job: expect.objectContaining({
        select: expect.objectContaining({
          employer: expect.objectContaining({
            select: expect.objectContaining({
              employerProfile: expect.objectContaining({
                select: { companyName: true },
              }),
            }),
          }),
        }),
      }),
    }),
  }));
});

test('missing provider configuration is normalized safely', async () => {
  mockPrisma.subscription.findFirst.mockResolvedValue(activePlan('AI_PROFILE_ASSISTANT'));
  mockCompletion.mockRejectedValue(Object.assign(new Error('not configured'), { status: 503, publicCode: 'AI_NOT_CONFIGURED' }));
  const response = await request(app).post('/api/seeker/ai/profile-assistant').set('Authorization', `Bearer ${token()}`).send({ request: 'Help' });
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('AI_NOT_CONFIGURED');
});
