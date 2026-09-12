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

const userRecord = (overrides = {}) => ({
  id: seekerId,
  firstName: 'Sarah',
  lastName: 'Johnson',
  email: 'sarah@example.com',
  phone: null,
  role: 'SEEKER',
  isActive: true,
  isVerified: true,
  lastLogin: new Date('2026-09-11T10:00:00.000Z'),
  createdAt: new Date('2026-08-14T10:00:00.000Z'),
  seekerProfile: { location: 'Lagos', professionalTitle: 'Product Designer' },
  employerProfile: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
});

test('unauthenticated requests are rejected', async () => {
  const response = await request(app).get('/api/admin/users');
  expect(response.status).toBe(401);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('non-admin requests are rejected', async () => {
  const response = await request(app)
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);
  expect(response.status).toBe(403);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('employers cannot access admin users', async () => {
  const response = await request(app)
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);
  expect(response.status).toBe(403);
  expect(response.body).toEqual({ message: 'Forbidden' });
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('admins receive paginated users without sensitive fields', async () => {
  mockPrisma.user.findMany.mockResolvedValue([userRecord()]);
  mockPrisma.user.count.mockResolvedValue(21);

  const response = await request(app)
    .get('/api/admin/users?page=2&limit=10')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.users[0]).toEqual(expect.objectContaining({ id: seekerId, role: 'SEEKER' }));
  expect(response.body.data.pagination).toEqual({ page: 2, limit: 10, total: 21, pages: 3 });
  expect(response.body.data.users[0]).not.toHaveProperty('passwordHash');
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
});

test('role, search, status, and sorting filters are passed to Prisma safely', async () => {
  const response = await request(app)
    .get('/api/admin/users?role=EMPLOYER&status=INACTIVE&search=Nova&sortBy=name&sortOrder=asc')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      role: 'EMPLOYER',
      isActive: false,
      OR: [
        { firstName: { contains: 'Nova', mode: 'insensitive' } },
        { lastName: { contains: 'Nova', mode: 'insensitive' } },
        { email: { contains: 'Nova', mode: 'insensitive' } },
      ],
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
  }));
  expect(mockPrisma.user.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
});

test('invalid query parameters are rejected', async () => {
  const response = await request(app)
    .get('/api/admin/users?limit=101&sortBy=passwordHash')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(400);
  expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
});

test('empty results return an empty page', async () => {
  const response = await request(app)
    .get('/api/admin/users?search=missing')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.users).toEqual([]);
  expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
});