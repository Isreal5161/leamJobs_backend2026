import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const adminId = '99999999-9999-4999-8999-999999999999';
const employerId = '11111111-1111-4111-8111-111111111111';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});
const authorization = (role, subject) => ['Bearer', token(role, subject)].join(' ');

const mockPrisma = {
  platformFeeConfiguration: { findUnique: jest.fn(), upsert: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({
    key: 'default',
    percentage: new Prisma.Decimal('5.00'),
    withdrawalPercentage: new Prisma.Decimal('0.00'),
    isActive: true,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  });
  mockPrisma.platformFeeConfiguration.upsert.mockImplementation(async ({ create, update }) => ({
    key: 'default',
    percentage: update.percentage ?? create.percentage,
    withdrawalPercentage: update.withdrawalPercentage ?? create.withdrawalPercentage,
    isActive: true,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  }));
});

test('admin can read the active platform fee configuration', async () => {
  const response = await request(app)
    .get('/api/admin/platform-fee')
    .set('Authorization', authorization('ADMIN', adminId));

  expect(response.status).toBe(200);
  expect(response.body.data.configuration.percentage).toBe('5.00');
  expect(response.body.data.configuration.withdrawalPercentage).toBe('0.00');
});

test('admin can update a valid percentage in the existing configuration record', async () => {
  const response = await request(app)
    .patch('/api/admin/platform-fee')
    .set('Authorization', authorization('ADMIN', adminId))
    .send({ percentage: 7.5 });

  expect(response.status).toBe(200);
  expect(mockPrisma.platformFeeConfiguration.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { key: 'default' },
    update: { percentage: new Prisma.Decimal('7.5'), isActive: true },
  }));
});

test('admin can update the withdrawal charge independently of the project funding charge', async () => {
  const response = await request(app)
    .patch('/api/admin/platform-fee')
    .set('Authorization', authorization('ADMIN', adminId))
    .send({ withdrawalPercentage: '5.00' });

  expect(response.status).toBe(200);
  expect(mockPrisma.platformFeeConfiguration.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { key: 'default' },
    update: { withdrawalPercentage: new Prisma.Decimal('5.00'), isActive: true },
  }));
});

test.each([
  ['negative', { percentage: -1 }],
  ['above 100%', { percentage: 100.01 }],
  ['excess precision', { percentage: 5.555 }],
  ['invalid withdrawal percentage', { withdrawalPercentage: '100.01' }],
  ['excess withdrawal precision', { withdrawalPercentage: '1.001' }],
  ['empty configuration update', {}],
  ['client-controlled fee fields', { percentage: 5, amount: 1 }],
])('admin fee update rejects %s input', async (_label, body) => {
  const response = await request(app)
    .patch('/api/admin/platform-fee')
    .set('Authorization', authorization('ADMIN', adminId))
    .send(body);

  expect(response.status).toBe(400);
  expect(mockPrisma.platformFeeConfiguration.upsert).not.toHaveBeenCalled();
});

test('non-admin users cannot change the platform fee', async () => {
  const response = await request(app)
    .patch('/api/admin/platform-fee')
    .set('Authorization', authorization('EMPLOYER', employerId))
    .send({ percentage: 5 });

  expect(response.status).toBe(403);
  expect(mockPrisma.platformFeeConfiguration.upsert).not.toHaveBeenCalled();
});

test('non-admin users cannot change withdrawal fee configuration', async () => {
  const response = await request(app)
    .patch('/api/admin/platform-fee')
    .set('Authorization', authorization('SEEKER', '33333333-3333-4333-8333-333333333333'))
    .send({ withdrawalPercentage: 5 });

  expect(response.status).toBe(403);
  expect(mockPrisma.platformFeeConfiguration.upsert).not.toHaveBeenCalled();
});
