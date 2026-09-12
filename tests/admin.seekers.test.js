import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = { user: { findMany: jest.fn(), count: jest.fn() } };

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const seekerRecord = (overrides = {}) => ({
  id: seekerId,
  firstName: 'Sarah',
  lastName: 'Johnson',
  email: 'sarah@example.com',
  phone: null,
  isActive: true,
  isVerified: true,
  lastLogin: new Date('2026-09-11T10:00:00.000Z'),
  createdAt: new Date('2026-08-14T10:00:00.000Z'),
  seekerProfile: {
    professionalTitle: 'Product Designer',
    location: 'Lagos',
    skills: ['Figma', 'Research'],
    resumeUrl: '/api/seeker/profile/resume',
    resumeObjectKey: 'seekers/resume.pdf',
    profilePictureUrl: '/api/seeker/profile/picture',
  },
  _count: { applications: 4 },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
});

test('unauthenticated requests are rejected', async () => {
  const response = await request(app).get('/api/admin/seekers');
  expect(response.status).toBe(401);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test.each(['SEEKER', 'EMPLOYER'])('%s users cannot access admin seekers', async (role) => {
  const subject = role === 'SEEKER' ? seekerId : employerId;
  const response = await request(app).get('/api/admin/seekers').set('Authorization', `Bearer ${token(role, subject)}`);
  expect(response.status).toBe(403);
  expect(response.body).toEqual({ message: 'Forbidden' });
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('admins receive seeker data with real counts and safe profile fields', async () => {
  mockPrisma.user.findMany.mockResolvedValue([seekerRecord()]);
  mockPrisma.user.count.mockResolvedValue(1);

  const response = await request(app).get('/api/admin/seekers').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.seekers[0]).toEqual(expect.objectContaining({ id: seekerId, applicationCount: 4 }));
  expect(response.body.data.seekers[0].profile).toEqual(expect.objectContaining({ hasResume: true }));
  expect(response.body.data.seekers[0]).not.toHaveProperty('passwordHash');
  expect(response.body.data.seekers[0].profile).not.toHaveProperty('resumeObjectKey');
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: 'SEEKER' }) }));
});

test('pagination and application-count sorting are passed safely to Prisma', async () => {
  const response = await request(app)
    .get('/api/admin/seekers?page=2&limit=10&sortBy=applicationCount&sortOrder=asc')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    skip: 10,
    take: 10,
    orderBy: [{ applications: { _count: 'asc' } }, { id: 'asc' }],
  }));
});

test('name and email search use User fields', async () => {
  const response = await request(app).get('/api/admin/seekers?search=Sarah').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      role: 'SEEKER',
      OR: [
        { firstName: { contains: 'Sarah', mode: 'insensitive' } },
        { lastName: { contains: 'Sarah', mode: 'insensitive' } },
        { email: { contains: 'Sarah', mode: 'insensitive' } },
      ],
    }),
  }));
});

test('status, verification, and location filters use real fields', async () => {
  const response = await request(app)
    .get('/api/admin/seekers?status=INACTIVE&verification=UNVERIFIED&location=Lagos')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      role: 'SEEKER',
      isActive: false,
      isVerified: false,
      seekerProfile: { is: { location: { contains: 'Lagos', mode: 'insensitive' } } },
    },
  }));
});

test('invalid sort fields are rejected', async () => {
  const response = await request(app).get('/api/admin/seekers?sortBy=passwordHash').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(400);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('seekers with zero applications remain included', async () => {
  mockPrisma.user.findMany.mockResolvedValue([seekerRecord({ _count: { applications: 0 }, seekerProfile: null })]);
  mockPrisma.user.count.mockResolvedValue(1);

  const response = await request(app).get('/api/admin/seekers').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.seekers).toHaveLength(1);
  expect(response.body.data.seekers[0].applicationCount).toBe(0);
});

test('empty results return an empty page', async () => {
  const response = await request(app).get('/api/admin/seekers?search=missing').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.seekers).toEqual([]);
  expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
});