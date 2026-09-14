import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  payment: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';
const paymentId = '22222222-2222-4222-8222-222222222222';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const payment = (id = paymentId) => ({
  id,
  providerReference: 'leamjobs_payment_1',
  transactionId: '123456',
  amount: '100.00',
  currency: 'NGN',
  status: 'SUCCESSFUL',
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  verifiedAt: new Date('2026-09-10T12:00:00.000Z'),
  createdAt: new Date('2026-09-10T11:00:00.000Z'),
  updatedAt: new Date('2026-09-10T12:00:00.000Z'),
  user: { id: seekerId, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  subscription: null,
  escrow: {
    id: '44444444-4444-4444-8444-444444444444',
    freelanceContract: { contract: { id: '55555555-5555-4555-8555-555555555555', job: { id: '66666666-6666-4666-8666-666666666666', title: 'Backend Developer' } } },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.payment.findMany.mockResolvedValue([]);
});

test('requires authentication and ADMIN authorization', async () => {
  expect((await request(app).get('/api/admin/payments')).status).toBe(401);
  for (const [role, subject] of [['SEEKER', seekerId], ['EMPLOYER', employerId]]) {
    const response = await request(app).get('/api/admin/payments').set('Authorization', `Bearer ${token(role, subject)}`);
    expect(response.status).toBe(403);
  }
});

test('returns safe payment records with cursor pagination and related context', async () => {
  mockPrisma.payment.findMany.mockResolvedValue([payment(), payment('77777777-7777-4777-8777-777777777777')]);

  const response = await request(app)
    .get('/api/admin/payments?limit=1&status=SUCCESSFUL&paymentType=CONTRACT_FUNDING&provider=FLUTTERWAVE&currency=ngn&search=ada&from=2026-09-01&to=2026-09-12')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.items).toEqual([expect.objectContaining({
    id: paymentId,
    providerReference: 'leamjobs_payment_1',
    transactionId: '123456',
    payer: { id: seekerId, name: 'Ada Lovelace', email: 'ada@example.com' },
    amount: '100.00',
    currency: 'NGN',
    context: expect.objectContaining({ contractId: '55555555-5555-4555-8555-555555555555', jobTitle: 'Backend Developer' }),
  })]);
  expect(response.body.data.items[0].metadata).toBeUndefined();
  expect(response.body.data.items[0].idempotencyKey).toBeUndefined();
  expect(response.body.data.nextCursor).toBe(paymentId);

  const query = mockPrisma.payment.findMany.mock.calls[0][0];
  expect(query.take).toBe(2);
  expect(query.where).toEqual(expect.objectContaining({ status: 'SUCCESSFUL', paymentType: 'CONTRACT_FUNDING', provider: 'FLUTTERWAVE', currency: 'NGN' }));
  expect(query.where.createdAt).toEqual({ gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-09-13T00:00:00.000Z') });
  expect(query.where.OR).toHaveLength(3);
});

test('supports cursor pagination and empty results', async () => {
  const cursor = '88888888-8888-4888-8888-888888888888';
  const response = await request(app)
    .get(`/api/admin/payments?limit=10&cursor=${cursor}`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true, data: { items: [], nextCursor: null } });
  expect(mockPrisma.payment.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ cursor: { id: cursor }, skip: 1, take: 11 }));
});

test.each([
  'limit=0',
  'limit=51',
  'status=UNKNOWN',
  'paymentType=UNKNOWN',
  'currency=NA',
  'from=2026-09-12&to=2026-09-01',
])('rejects invalid payment query: %s', async (query) => {
  const response = await request(app).get(`/api/admin/payments?${query}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(400);
  expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
});