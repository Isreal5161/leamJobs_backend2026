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

const candidate = (id, priority, entitlements = [], overrides = {}) => {
  const visibilityBoosted = entitlements.some((key) => ['PROFILE_VISIBILITY_BOOST', 'FEATURED_CANDIDATE'].includes(key));
  return {
    id,
    firstName: 'Ada',
    lastName: 'Lovelace',
    professionalTitle: 'Software Engineer',
    bio: 'Builds reliable systems.',
    location: 'Lagos',
    skills: ['JavaScript'],
    profilePictureUrl: null,
    priority,
    availability: 'AVAILABLE_NOW',
    subscriptionTier: priority === 2 ? 'PREMIUM' : priority === 1 ? 'PROFESSIONAL' : 'BASIC',
    featured: visibilityBoosted,
    visibilityBoosted,
    ...overrides,
  };
};

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
    expect(sqlText()).toContain('sp."availability"');
    expect(sqlText()).not.toContain('u."isVerified" = true');
  });

  test('maps the backend boost field to both employer badges', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('premium', 2, ['PROFILE_VISIBILITY_BOOST']),
      candidate('professional', 1, ['PROFESSIONAL_CANDIDATE_VISIBILITY']),
      candidate('free', 0),
    ]);

    const response = await request(app)
      .get('/api/employer/candidates?limit=10')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(response.body.data.candidates.map(({ id }) => id)).toEqual(['premium', 'professional', 'free']);
    expect(response.body.data.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'premium', subscriptionTier: 'PREMIUM', featured: true, visibilityBoosted: true }),
      expect.objectContaining({ id: 'professional', subscriptionTier: 'PROFESSIONAL', featured: false, visibilityBoosted: false }),
      expect.objectContaining({ id: 'free', subscriptionTier: 'BASIC', featured: false, visibilityBoosted: false }),
    ]));
    expect(sqlText()).toContain('s."status" = \'ACTIVE\'');
    expect(sqlText()).toContain('INNER JOIN "SubscriptionPlan" spn');
    expect(sqlText()).toContain('INNER JOIN "PlanEntitlement" pe');
    expect(sqlText()).toContain('INNER JOIN "Entitlement" e');
    expect(sqlText()).toContain('e."key" IN');
    expect(sqlText()).toContain('sp."availability"');
  });

  test('builds a single Premium-only visibility priority from the canonical entitlement', async () => {
    await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    const query = sqlText();
    expect(query).toMatch(/WHEN e\."key" IN\s*\([^)]*PROFILE_VISIBILITY_BOOST[^)]*FEATURED_CANDIDATE[^)]*\) THEN 2[\s\S]*WHEN e\."key" = 'PROFESSIONAL_CANDIDATE_VISIBILITY' THEN 1[\s\S]*ELSE 0/);
    expect(query).toContain('BOOL_OR(e."key" IN');
    expect(query).toContain('PROFILE_VISIBILITY_BOOST');
    expect(query).toContain('FEATURED_CANDIDATE');
    expect(query).toContain('AS "subscriptionTier"');
    expect(query).not.toContain('AS "featured"');
    expect(query).toContain('WHERE e."isActive" = true');
    expect(query).toContain('s."status" = \'ACTIVE\'');
    expect(query).toContain('trial."status" = \'ACTIVE\'');
    expect(query).toContain('ORDER BY COALESCE(ce."priority", 0) DESC, u."id" ASC');
  });

  test.each(['PENDING', 'EXPIRED', 'CANCELLED', 'FAILED'])('does not grant %s subscriptions priority', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([candidate('non-active-subscription', 0)]);
    const response = await request(app)
      .get('/api/employer/candidates')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(response.body.data.candidates[0]).toMatchObject({ subscriptionTier: 'BASIC', featured: false, visibilityBoosted: false });
    expect(sqlText()).toContain('s."status" = \'ACTIVE\'');
  });

  test('uses deterministic database ordering and keyset pagination without loading all pages', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('featured-a', 2, ['FEATURED_CANDIDATE']),
      candidate('featured-b', 2, ['FEATURED_CANDIDATE']),
      candidate('premium-c', 2, ['PROFILE_VISIBILITY_BOOST']),
    ]);

    const first = await request(app)
      .get('/api/employer/candidates?limit=2')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(first.body.data.candidates.map(({ id }) => id)).toEqual(['featured-a', 'featured-b']);
    expect(first.body.data.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(first.body.data.pagination.nextCursor).toEqual(expect.any(String));
    expect(JSON.parse(Buffer.from(first.body.data.pagination.nextCursor, 'base64url').toString('utf8'))).toEqual({ priority: 2, id: 'featured-b' });
    expect(sqlText()).toContain('ORDER BY COALESCE(ce."priority", 0) DESC, u."id" ASC');
    expect(sqlText()).toContain('LIMIT');

    mockPrisma.$queryRaw.mockResolvedValue([
      candidate('premium-c', 2, ['PROFILE_VISIBILITY_BOOST']),
      candidate('professional-a', 1, ['PROFESSIONAL_CANDIDATE_VISIBILITY']),
      candidate('professional-b', 1, ['PROFESSIONAL_CANDIDATE_VISIBILITY']),
    ]);
    const second = await request(app)
      .get(`/api/employer/candidates?limit=2&cursor=${first.body.data.pagination.nextCursor}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(second.body.data.candidates.map(({ id }) => id)).toEqual(['premium-c', 'professional-a']);
    expect(JSON.parse(Buffer.from(second.body.data.pagination.nextCursor, 'base64url').toString('utf8'))).toEqual({ priority: 1, id: 'professional-a' });
    expect(second.body.data.candidates[1]).toMatchObject({ subscriptionTier: 'PROFESSIONAL', featured: false, visibilityBoosted: false });

    mockPrisma.$queryRaw.mockResolvedValue([candidate('professional-b', 1, ['PROFESSIONAL_CANDIDATE_VISIBILITY']), candidate('basic-a', 0)]);
    const third = await request(app)
      .get(`/api/employer/candidates?limit=2&cursor=${second.body.data.pagination.nextCursor}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(third.body.data.candidates.map(({ id }) => id)).toEqual(['professional-b', 'basic-a']);
    expect(third.body.data.pagination).toMatchObject({ hasMore: false, nextCursor: null });
    expect(new Set([
      ...first.body.data.candidates.map(({ id }) => id),
      ...second.body.data.candidates.map(({ id }) => id),
      ...third.body.data.candidates.map(({ id }) => id),
    ]).size).toBe(6);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  test('supports search, location, and skill filters in the database query', async () => {
    const response = await request(app)
      .get('/api/employer/candidates?search=engineer&location=Lagos&skill=JavaScript')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(response.status).toBe(200);
    expect(sqlText()).toContain('ILIKE');
    expect(sqlText()).toContain('ANY(sp."skills")');
  });

  test.each(['0', '51'])('rejects candidate page limit %s outside the supported range', async (limit) => {
    const response = await request(app)
      .get(`/api/employer/candidates?limit=${limit}`)
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);

    expect(response.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
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
      subscriptionTier: 'BASIC',
      availability: 'AVAILABLE_NOW',
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

    const clientPriority = await request(app)
      .get('/api/employer/candidates?featured=true&visibilityBoosted=true&priority=2&plan=PREMIUM&planKey=PREMIUM&tier=PROFESSIONAL&subscriptionTier=PREMIUM&availability=AVAILABLE_NOW&jobFitScore=100')
      .set('Authorization', `Bearer ${token('EMPLOYER', 'employer-1')}`);
    expect(clientPriority.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });
});
