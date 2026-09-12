import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findMany: jest.fn(), count: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const companyRecord = (overrides = {}) => ({
  id: employerId,
  email: 'owner@example.com',
  firstName: 'Company',
  lastName: 'Owner',
  isActive: true,
  isVerified: true,
  createdAt: new Date('2026-08-14T10:00:00.000Z'),
  employerProfile: {
    id: 'profile-id',
    companyName: 'Example Company',
    companyDescription: 'A real company',
    website: 'https://example.com',
    industry: 'Technology',
    companySize: '11-50',
    location: 'Lagos',
    companyLogoUrl: null,
  },
  _count: { jobs: 3 },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
});

test('unauthenticated requests are rejected', async () => {
  const response = await request(app).get('/api/admin/companies');
  expect(response.status).toBe(401);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test.each(['SEEKER', 'EMPLOYER'])('%s users cannot access admin companies', async (role) => {
  const subject = role === 'SEEKER' ? seekerId : employerId;
  const response = await request(app)
    .get('/api/admin/companies')
    .set('Authorization', `Bearer ${token(role, subject)}`);

  expect(response.status).toBe(403);
  expect(response.body).toEqual({ message: 'Forbidden' });
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('admins receive company data with job counts and no sensitive fields', async () => {
  mockPrisma.user.findMany.mockResolvedValue([companyRecord()]);
  mockPrisma.user.count.mockResolvedValue(1);

  const response = await request(app)
    .get('/api/admin/companies')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.companies[0]).toEqual(expect.objectContaining({
    id: 'profile-id',
    userId: employerId,
    companyName: 'Example Company',
    email: 'owner@example.com',
    jobCount: 3,
  }));
  expect(response.body.data.companies[0]).not.toHaveProperty('passwordHash');
  expect(response.body.data.companies[0]).not.toHaveProperty('companyLogoKey');
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
});

test('pagination and approved sorting fields are passed safely to Prisma', async () => {
  const response = await request(app)
    .get('/api/admin/companies?page=2&limit=10&sortBy=jobCount&sortOrder=asc')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    skip: 10,
    take: 10,
    orderBy: [{ jobs: { _count: 'asc' } }, { id: 'asc' }],
  }));
});

test('company-name, email, industry, and company-size filters use the real relations', async () => {
  const response = await request(app)
    .get('/api/admin/companies?search=Example&industry=Technology&companySize=11-50')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      role: 'EMPLOYER',
      employerProfile: { is: { industry: { equals: 'Technology', mode: 'insensitive' }, companySize: { equals: '11-50', mode: 'insensitive' } } },
      OR: [
        { email: { contains: 'Example', mode: 'insensitive' } },
        { employerProfile: { is: { companyName: { contains: 'Example', mode: 'insensitive' } } } },
      ],
    },
  }));
});

test.each([
  'sortBy=passwordHash',
  'sortOrder=sideways',
])('rejects invalid query values: %s', async (query) => {
  const response = await request(app)
    .get(`/api/admin/companies?${query}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(400);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('employers with zero jobs are included', async () => {
  mockPrisma.user.findMany.mockResolvedValue([companyRecord({ _count: { jobs: 0 } })]);
  mockPrisma.user.count.mockResolvedValue(1);

  const response = await request(app)
    .get('/api/admin/companies')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.companies).toHaveLength(1);
  expect(response.body.data.companies[0].jobCount).toBe(0);
});

test('empty results return an empty page', async () => {
  const response = await request(app)
    .get('/api/admin/companies?search=missing')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.companies).toEqual([]);
  expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
});