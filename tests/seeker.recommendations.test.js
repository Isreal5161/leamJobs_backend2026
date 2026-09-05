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
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const token = (role = 'SEEKER') => jwt.sign({ sub: seekerId, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });
const createdAt = new Date('2026-09-05T12:00:00.000Z');
const company = { employerProfile: { companyName: 'Example Ltd', companyDescription: null, website: null, industry: 'Technology', companySize: null, location: 'Lagos', companyLogoUrl: null } };
const job = (id, skills, overrides = {}) => ({ id, title: `Job ${id}`, description: 'Description', location: 'Lagos', jobType: 'NORMAL_EMPLOYMENT', skills, requirements: null, createdAt, applicationDeadline: null, employer: company, employmentCompensation: null, freelanceCompensation: null, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ skills: ['React', ' react ', 'Node.js'] });
  mockPrisma.job.findMany.mockResolvedValue([
    job('22222222-2222-4222-8222-222222222222', ['REACT', 'Node.js', 'TypeScript', 'PostgreSQL']),
    job('33333333-3333-4333-8333-333333333333', ['Python']),
    job('44444444-4444-4444-8444-444444444444', []),
  ]);
});

describe('GET /api/seeker/recommendations', () => {
  test('returns ranked approved recommendations with explainable skill matches', async () => {
    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations[0]).toMatchObject({ matchScore: 50, matchedSkills: ['REACT', 'Node.js'], totalJobSkills: 4 });
    expect(response.body.data.recommendations[2]).toMatchObject({ matchScore: 0, matchedSkills: [], totalJobSkills: 0 });
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'APPROVED' } }));
  });

  test('returns empty recommendations for a seeker without skills', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValue(null);
    const response = await request(app).get('/api/seeker/recommendations').set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ recommendations: [], nextCursor: null });
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  test('supports deterministic cursor pagination', async () => {
    const cursor = '22222222-2222-4222-8222-222222222222';
    const response = await request(app).get(`/api/seeker/recommendations?limit=1&cursor=${cursor}`).set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(1);
    expect(response.body.data.recommendations[0].job.id).toBe('33333333-3333-4333-8333-333333333333');
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
