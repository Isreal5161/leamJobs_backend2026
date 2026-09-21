import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  seekerProfile: { findUnique: jest.fn() },
  job: { findMany: jest.fn() },
  subscription: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const token = (role = 'SEEKER') => jwt.sign({ sub: seekerId, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });
const createdAt = new Date('2026-09-05T12:00:00.000Z');
const company = { employerProfile: { companyName: 'Example Ltd', companyDescription: null, website: null, industry: 'Technology', companySize: null, location: 'Lagos', companyLogoUrl: null } };
const job = (id, skills, overrides = {}) => ({ id, title: `Job ${id}`, description: 'Description', location: 'Lagos', jobType: 'NORMAL_EMPLOYMENT', skills, requirements: null, createdAt, applicationDeadline: null, employer: company, employmentCompensation: null, freelanceCompensation: null, ...overrides });
const manyJobs = () => Array.from({ length: 13 }, (_, index) => job(`job-${String(index + 1).padStart(2, '0')}`, ['React'], { createdAt: new Date(createdAt.getTime() - index * 1000) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ skills: ['React', ' react ', 'Node.js'] });
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.job.findMany.mockResolvedValue([
    job('22222222-2222-4222-8222-222222222222', ['REACT', 'Node.js', 'TypeScript', 'PostgreSQL']),
    job('33333333-3333-4333-8333-333333333333', ['Python']),
    job('44444444-4444-4444-8444-444444444444', []),
  ]);
  mockPrisma.$queryRaw.mockResolvedValue([
    { id: '22222222-2222-4222-8222-222222222222', matchScore: 50, recommendationRank: 1 },
    { id: '33333333-3333-4333-8333-333333333333', matchScore: 0, recommendationRank: 2 },
    { id: '44444444-4444-4444-8444-444444444444', matchScore: 0, recommendationRank: 3 },
  ]);
});

describe('GET /api/seeker/recommendations', () => {
  test('returns ranked approved recommendations with explainable skill matches', async () => {
    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations[0]).toMatchObject({ matchScore: 50, matchedSkills: ['REACT', 'Node.js'], totalJobSkills: 4 });
    expect(response.body.data.recommendations[2]).toMatchObject({ matchScore: 0, matchedSkills: [], totalJobSkills: 0 });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRaw.mock.calls[0][0].strings.join(' ')).toEqual(expect.stringContaining('job.status = \'APPROVED\''));
    expect(mockPrisma.$queryRaw.mock.calls[0][0].strings.join(' ')).toEqual(expect.stringContaining('applicationDeadline'));
    expect(mockPrisma.job.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: expect.arrayContaining([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]) } } }));
  });

  test('returns empty recommendations for a seeker without skills', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValue(null);
    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ recommendations: [], nextCursor: null });
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  test('keeps match scores and ordering unchanged for an active subscription with RECOMMENDATION_BOOST', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'RECOMMENDATION_BOOST' } }] },
    });

    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations[0]).toMatchObject({ matchScore: 50, matchedSkills: ['REACT', 'Node.js'], totalJobSkills: 4 });
    expect(response.body.data.recommendations[1]).toMatchObject({ matchScore: 0, matchedSkills: [], totalJobSkills: 1 });
    expect(response.body.data.recommendations.map(({ job: item }) => item.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  test('free seekers are capped at six recommendations even when requesting more', async () => {
    mockPrisma.job.findMany.mockResolvedValue(manyJobs());
    mockPrisma.$queryRaw.mockResolvedValue(manyJobs().slice(0, 6).map((item, index) => ({ id: item.id, matchScore: 100, recommendationRank: index + 1 })));

    const response = await request(app)
      .get('/api/seeker/recommendations?limit=50')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(6);
    expect(mockPrisma.job.findMany.mock.calls[0][0].where.id.in).toHaveLength(6);
    expect(response.body.data.nextCursor).toBeNull();
  });

  test('active entitled seekers can receive up to twelve recommendations with unchanged scores', async () => {
    mockPrisma.job.findMany.mockResolvedValue(manyJobs());
    mockPrisma.$queryRaw.mockResolvedValue(manyJobs().slice(0, 12).map((item, index) => ({ id: item.id, matchScore: 100, recommendationRank: index + 1 })));
    mockPrisma.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'RECOMMENDATION_BOOST' } }] },
    });

    const response = await request(app)
      .get('/api/seeker/recommendations?limit=50')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(12);
    expect(response.body.data.recommendations.every(({ matchScore }) => matchScore === 100)).toBe(true);
    expect(new Set(response.body.data.recommendations.map(({ job: item }) => item.id)).size).toBe(12);
    expect(response.body.data.nextCursor).toBeNull();
  });

  test.each([
    ['no subscription', null],
    ['PENDING subscription', null],
    ['EXPIRED subscription', null],
    ['CANCELLED subscription', null],
    ['FAILED subscription', null],
    ['active subscription without the entitlement', { status: 'ACTIVE', plan: { entitlements: [{ entitlement: { key: 'PROFILE_ANALYTICS' } }] } }],
  ])('%s receives the free recommendation window', async (_label, subscription) => {
    mockPrisma.job.findMany.mockResolvedValue(manyJobs());
    mockPrisma.$queryRaw.mockResolvedValue(manyJobs().slice(0, 6).map((item, index) => ({ id: item.id, matchScore: 100, recommendationRank: index + 1 })));
    mockPrisma.subscription.findFirst.mockResolvedValue(subscription);

    const response = await request(app)
      .get('/api/seeker/recommendations?limit=12')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(6);
  });

  test('respects a smaller requested limit for both free and entitled seekers', async () => {
    mockPrisma.job.findMany.mockResolvedValue(manyJobs());
    mockPrisma.$queryRaw.mockResolvedValue(manyJobs().slice(0, 6).map((item, index) => ({ id: item.id, matchScore: 100, recommendationRank: index + 1 })));
    const freeResponse = await request(app).get('/api/seeker/recommendations?limit=3').set('Authorization', `Bearer ${token()}`);
    expect(freeResponse.body.data.recommendations).toHaveLength(3);

    mockPrisma.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'RECOMMENDATION_BOOST' } }] },
    });
    const paidResponse = await request(app).get('/api/seeker/recommendations?limit=3').set('Authorization', `Bearer ${token()}`);
    expect(paidResponse.body.data.recommendations).toHaveLength(3);
  });

  test('resolves subscription entitlement once per request, not per job', async () => {
    mockPrisma.job.findMany.mockResolvedValue(manyJobs());
    mockPrisma.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      plan: { entitlements: [{ entitlement: { key: 'RECOMMENDATION_BOOST' } }] },
    });

    await request(app).get('/api/seeker/recommendations?limit=12').set('Authorization', `Bearer ${token()}`);

    expect(mockPrisma.subscription.findFirst).toHaveBeenCalledTimes(1);
  });

  test('supports deterministic cursor pagination', async () => {
    const cursor = '22222222-2222-4222-8222-222222222222';
    const response = await request(app).get(`/api/seeker/recommendations?limit=1&cursor=${cursor}`).set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(1);
    expect(response.body.data.recommendations[0].job.id).toBe('33333333-3333-4333-8333-333333333333');
  });

  test('cursor pagination cannot exceed the free recommendation window', async () => {
    const cursorJobs = Array.from({ length: 13 }, (_, index) => job(`10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, ['React'], { createdAt: new Date(createdAt.getTime() - index * 1000) }));
    mockPrisma.job.findMany.mockResolvedValue(cursorJobs);
    mockPrisma.$queryRaw.mockResolvedValue(cursorJobs.slice(0, 6).map((item, index) => ({ id: item.id, matchScore: 100, recommendationRank: index + 1 })));
    const firstPage = await request(app).get('/api/seeker/recommendations?limit=1').set('Authorization', `Bearer ${token()}`);
    const seen = [...firstPage.body.data.recommendations.map(({ job: item }) => item.id)];
    let nextCursor = firstPage.body.data.nextCursor;
    while (nextCursor) {
      const response = await request(app).get(`/api/seeker/recommendations?limit=1&cursor=${nextCursor}`).set('Authorization', `Bearer ${token()}`);
      seen.push(...response.body.data.recommendations.map(({ job: item }) => item.id));
      nextCursor = response.body.data.nextCursor;
    }
    expect(seen.length).toBeLessThanOrEqual(6);
  });

  test.each(['EMPLOYER', 'ADMIN'])('rejects %s role', async (role) => {
    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token(role)}`);
    expect(response.status).toBe(403);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  test('rejects ownership query parameters and malformed pagination', async () => {
    const ownership = await request(app).get('/api/seeker/recommendations?userId=other').set('Authorization', `Bearer ${token()}`);
    const malformed = await request(app).get('/api/seeker/recommendations?limit=0').set('Authorization', `Bearer ${token()}`);
    expect(ownership.status).toBe(400);
    expect(malformed.status).toBe(400);
  });
});
