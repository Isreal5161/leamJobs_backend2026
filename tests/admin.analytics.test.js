import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const model = () => ({ count: jest.fn(), groupBy: jest.fn() });
const mockPrisma = {
  user: model(), job: model(), application: model(), contract: model(), payment: model(), subscription: model(), escrow: model(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const employerId = '11111111-1111-4111-8111-111111111111';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const resource of [mockPrisma.user, mockPrisma.job, mockPrisma.application, mockPrisma.contract, mockPrisma.payment, mockPrisma.subscription, mockPrisma.escrow]) {
    resource.count.mockResolvedValue(0);
    resource.groupBy.mockResolvedValue([]);
  }
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.user.count
    .mockResolvedValueOnce(12).mockResolvedValueOnce(7).mockResolvedValueOnce(4).mockResolvedValueOnce(10).mockResolvedValueOnce(8);
  mockPrisma.job.count.mockResolvedValue(9);
  mockPrisma.application.count.mockResolvedValue(22);
  mockPrisma.contract.count.mockResolvedValue(5);
});

test('requires authentication and ADMIN authorization', async () => {
  expect((await request(app).get('/api/admin/analytics')).status).toBe(401);
  for (const [role, subject] of [['SEEKER', seekerId], ['EMPLOYER', employerId]]) {
    const response = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${token(role, subject)}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  }
});

test.each([
  'from=2026-99-99',
  'to=not-a-date',
  'from=2026-09-12&to=2026-09-01',
  'granularity=year',
])('rejects invalid analytics query: %s', async (query) => {
  const response = await request(app).get(`/api/admin/analytics?${query}`).set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(400);
});

test('admins receive database-backed summaries, trends, breakdowns, and currency-separated financial data', async () => {
  mockPrisma.job.groupBy.mockResolvedValue([{ status: 'APPROVED', _count: { _all: 6 } }]);
  mockPrisma.application.groupBy.mockResolvedValue([{ status: 'APPLIED', _count: { _all: 10 } }]);
  mockPrisma.contract.groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 2 } }, { type: 'FREELANCE_PROJECT', _count: { _all: 1 } }]);
  mockPrisma.payment.groupBy
    .mockResolvedValueOnce([{ status: 'SUCCESSFUL', _count: { _all: 3 } }])
    .mockResolvedValueOnce([{ paymentType: 'SUBSCRIPTION', _count: { _all: 2 } }])
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { amount: '100.00' } }, { currency: 'USD', _sum: { amount: '20.00' } }]);
  mockPrisma.escrow.groupBy
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { fundedAmount: '500.00' } }])
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { releasedAmount: '450.00' } }])
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { platformFeeAmount: '25.00' } }]);
  mockPrisma.$queryRaw.mockResolvedValue([{ date: '2026-09-01', count: 3 }]);

  const response = await request(app)
    .get('/api/admin/analytics?from=2026-09-01&to=2026-09-12&granularity=day')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.summary).toEqual(expect.objectContaining({ totalUsers: 12, totalSeekers: 7, totalEmployers: 4, activeUsers: 10, verifiedUsers: 8, totalJobs: 9, approvedJobs: 6, pendingJobs: 0, rejectedJobs: 0, closedJobs: 0, totalApplications: 22, totalContracts: 5 }));
  expect(response.body.data.trends.users).toEqual([{ date: '2026-09-01', count: 3 }]);
  expect(response.body.data.financial.successfulPayments).toEqual([{ currency: 'NGN', amount: '100.00' }, { currency: 'USD', amount: '20.00' }]);
  expect(response.body.data.financial.fundedEscrow).toEqual([{ currency: 'NGN', amount: '500.00' }]);
  expect(response.body.data.breakdowns.jobsByStatus).toEqual(expect.arrayContaining([{ status: 'APPROVED', count: 6 }, { status: 'REJECTED', count: 0 }]));
  expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(4);
});

test('uses distinct funded, released, and platform-fee escrow semantics', async () => {
  mockPrisma.escrow.groupBy
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { fundedAmount: '100.00' } }])
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { releasedAmount: '80.00' } }])
    .mockResolvedValueOnce([{ currency: 'NGN', _sum: { platformFeeAmount: '5.00' } }]);

  const response = await request(app).get('/api/admin/analytics?from=2026-09-01&to=2026-09-02').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.financial).toEqual(expect.objectContaining({
    fundedEscrow: [{ currency: 'NGN', amount: '100.00' }],
    releasedEscrow: [{ currency: 'NGN', amount: '80.00' }],
    platformFees: [{ currency: 'NGN', amount: '5.00' }],
  }));
  const escrowCalls = mockPrisma.escrow.groupBy.mock.calls;
  expect(escrowCalls[0][0].where.status).toEqual({ in: ['FUNDED', 'RELEASE_ELIGIBLE'] });
  expect(escrowCalls[1][0].where.status).toBe('RELEASED');
  expect(escrowCalls[2][0].where.status).toEqual({ in: ['FUNDED', 'RELEASE_ELIGIBLE', 'RELEASED'] });
});

test('keeps the requested UTC date boundaries in the response', async () => {
  const response = await request(app)
    .get('/api/admin/analytics?from=2026-09-01&to=2026-09-07&granularity=day')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.data.dateRange).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z', granularity: 'day' });
});

test('trend SQL uses explicit UTC casts and reporting-range bucket clamping', async () => {
  const response = await request(app)
    .get('/api/admin/analytics?from=2026-09-03&to=2026-09-12&granularity=week')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  const sqlText = mockPrisma.$queryRaw.mock.calls
    .map(([query]) => query.strings.join(' '))
    .join(' ');
  expect(sqlText).toContain('::timestamptz');
  expect(sqlText).toContain("AT TIME ZONE 'UTC'");
  expect(sqlText).toContain('GREATEST(buckets.bucket');
  expect(sqlText).toContain('"createdAt" <');
});

test('default date range is provided and empty aggregates remain valid', async () => {
  const response = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${token('ADMIN', adminId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.dateRange.granularity).toBe('day');
  expect(response.body.data.trends).toEqual({ users: [], jobs: [], applications: [], contracts: [] });
  expect(response.body.data.financial).toEqual({ successfulPayments: [], fundedEscrow: [], releasedEscrow: [], platformFees: [] });
});