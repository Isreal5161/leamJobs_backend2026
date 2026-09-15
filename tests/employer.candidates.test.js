import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = { $queryRaw: jest.fn() };
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const candidate = (id, priority, entitlements = [], overrides = {}) => ({
  id,
  firstName: 'Ada',
  lastName: 'Lovelace',
  professionalTitle: 'Software Engineer',
  bio: 'Builds reliable systems.',
  location: 'Lagos',
  skills: ['JavaScript'],
  profilePictureUrl: null,
  priority,
  featured: entitlements.includes('FEATURED_CANDIDATE'),
  visibilityBoosted: entitlements.includes('PROFILE_VISIBILITY_BOOST'),
  ...overrides,
});

const sqlText = () => mockPrisma.$queryRaw.mock.calls[0][0].strings.join(' ');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe('Employer candidate discovery', () => {
  test('requires employer authentication', async () => {
    const response = await request(app).get('/api/employer/candidates');
    expect(response.status).toBe(401);
  });

  test.each(['SEEKER', 'ADMIN'])('%s cannot access candidates', async (role) => {
    const response = await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token(role, 'restricted-user')}`);
    expect(response.status).toBe(403);
  });

  test('uses only active seeker accounts with an existing profile and no verification requirement', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([candidate('active-seeker', 0)]);

    const response = await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.candidates[0].id).toBe('active-seeker');
    expect(sqlText()).toContain('u."role" = \'SEEKER\'');
    expect(sqlText()).toContain('u."isActive" = true');
    expect(sqlText()).toContain('INNER JOIN "SeekerProfile" sp');
    expect(sqlText()).not.toContain('u."isVerified" = true');
  });

  test('resolves active entitlement priority through the full relation', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('premium', 2, ['PROFILE_VISIBILITY_BOOST', 'FEATURED_CANDIDATE']),
      candidate('professional', 1, ['PROFILE_VISIBILITY_BOOST']),
      candidate('free', 0),
    ]);

    const response = await request(app)
      .get('/api/employer/candidates?limit=10')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(response.body.data.candidates.map(({ id }) => id)).toEqual(['premium', 'professional', 'free']);
    expect(response.body.data.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'premium', featured: true, visibilityBoosted: true }),
      expect.objectContaining({ id: 'professional', featured: false, visibilityBoosted: true }),
      expect.objectContaining({ id: 'free', featured: false, visibilityBoosted: false }),
    ]));
    expect(sqlText()).toContain('s."status" = \'ACTIVE\'');
    expect(sqlText()).toContain('INNER JOIN "SubscriptionPlan" spn');
    expect(sqlText()).toContain('INNER JOIN "PlanEntitlement" pe');
    expect(sqlText()).toContain('INNER JOIN "Entitlement" e');
    expect(sqlText()).toContain('e."key" IN');
  });

  test.each(['PENDING', 'EXPIRED', 'CANCELLED', 'FAILED'])('does not grant %s subscriptions priority', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([candidate('non-active-subscription', 0)]);
    const response = await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(response.body.data.candidates[0]).toMatchObject({ featured: false, visibilityBoosted: false });
    expect(sqlText()).toContain('s."status" = \'ACTIVE\'');
  });

  test('uses deterministic database ordering and keyset pagination without loading all pages', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('featured-a', 2, ['FEATURED_CANDIDATE']),
      candidate('featured-b', 2, ['FEATURED_CANDIDATE']),
      candidate('visibility-a', 1, ['PROFILE_VISIBILITY_BOOST']),
    ]);

    const first = await request(app)
      .get('/api/employer/candidates?limit=2')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(first.body.data.candidates.map(({ id }) => id)).toEqual(['featured-a', 'featured-b']);
    expect(first.body.data.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(first.body.data.pagination.nextCursor).toEqual(expect.any(String));
    expect(sqlText()).toContain('ORDER BY COALESCE(ce."priority", 0) DESC, u."id" ASC');
    expect(sqlText()).toContain('LIMIT');

    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('visibility-a', 1, ['PROFILE_VISIBILITY_BOOST']),
      candidate('normal-a', 0),
    ]);
    const second = await request(app)
      .get(`/api/employer/candidates?limit=2&cursor=${first.body.data.pagination.nextCursor}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(second.body.data.candidates.map(({ id }) => id)).toEqual(['visibility-a', 'normal-a']);
    expect(new Set([
      ...first.body.data.candidates.map(({ id }) => id),
      ...second.body.data.candidates.map(({ id }) => id),
    ]).size).toBe(4);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test('supports search, location, and skill filters in the database query', async () => {
    const response = await request(app)
      .get('/api/employer/candidates?search=engineer&location=Lagos&skill=JavaScript')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(response.status).toBe(200);
    expect(sqlText()).toContain('ILIKE');
    expect(sqlText()).toContain('ANY(sp."skills")');
  });

  test('keeps the employer response privacy-safe', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([candidate('private-candidate', 0, [], {
      email: 'private@example.com',
      phone: 'private-phone',
      passwordHash: 'private-password',
      resumeUrl: 'private-resume',
      wallet: { availableBalance: '100' },
    })]);

    const response = await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    const returned = response.body.data.candidates[0];

    expect(returned).toEqual({
      id: 'private-candidate',
      firstName: 'Ada',
      lastName: 'Lovelace',
      profile: {
        professionalTitle: 'Software Engineer',
        bio: 'Builds reliable systems.',
        location: 'Lagos',
        skills: ['JavaScript'],
        profilePictureUrl: null,
      },
      visibilityBoosted: false,
      featured: false,
    });
  });

  test('rejects malformed cursors and unknown query parameters', async () => {
    const invalidCursor = await request(app)
      .get('/api/employer/candidates?cursor=invalid.cursor')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(invalidCursor.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();

    const unknownQuery = await request(app)
      .get('/api/employer/candidates?sort=featured')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(unknownQuery.status).toBe(400);
  });
});
