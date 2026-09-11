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
const seekerId = '33333333-3333-4333-8333-333333333333';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const walletId = 'wwwwwwww-wwww-4www-8www-wwwwwwwwwwww';

const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const escrowRecord = ({ status = 'RELEASE_ELIGIBLE', releasedAmount = '0.00', releasedAt = null } = {}) => ({
  id: escrowId,
  freelanceContractId: contractId,
  grossAmount: new Prisma.Decimal('100000.00'),
  platformFeeAmount: new Prisma.Decimal('5000.00'),
  seekerNetAmount: new Prisma.Decimal('95000.00'),
  currency: 'NGN',
  status,
  fundedAmount: new Prisma.Decimal('100000.00'),
  releasedAmount: new Prisma.Decimal(releasedAmount),
  releasedAt,
  freelanceContract: {
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    completionSubmittedAt: new Date('2026-09-11T10:00:00.000Z'),
    employerCompletionConfirmedAt: new Date('2026-09-11T11:00:00.000Z'),
    workStatus: 'RELEASE_ELIGIBLE',
    contract: { id: contractId, type: 'FREELANCE_PROJECT', status: 'ACTIVE', seekerId },
  },
});

const mockPrisma = {
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  wallet: { update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  financialLedgerEntry: { create: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw
    .mockResolvedValueOnce([{ id: escrowId }])
    .mockResolvedValueOnce([{ id: walletId, currency: 'NGN', availableBalance: new Prisma.Decimal('1000.00'), pendingWithdrawalBalance: new Prisma.Decimal('0.00') }]);
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord());
  mockPrisma.wallet.update.mockResolvedValue({ availableBalance: new Prisma.Decimal('96000.00') });
  mockPrisma.financialLedgerEntry.create.mockResolvedValue({ id: 'ledger-id' });
  mockPrisma.escrow.update.mockResolvedValue(escrowRecord({ status: 'RELEASED', releasedAmount: '95000.00', releasedAt: new Date('2026-09-11T12:00:00.000Z') }));
  mockPrisma.freelanceContract.update.mockResolvedValue({});
});

test('unauthenticated users cannot release contract funds', async () => {
  const response = await request(app).post(`/api/admin/contracts/${contractId}/release`);
  expect(response.status).toBe(401);
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test.each(['SEEKER', 'EMPLOYER'])('%s users cannot release contract funds', async (role) => {
  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token(role, role === 'SEEKER' ? seekerId : employerId)}`);
  expect(response.status).toBe(403);
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});

test('admin release credits seeker NET amount and records one wallet ledger entry', async () => {
  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('Contract funds released successfully');
  expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  expect(mockPrisma.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: walletId },
    data: { availableBalance: new Prisma.Decimal('96000.00'), version: { increment: 1 } },
  }));
  expect(mockPrisma.financialLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      entryType: 'WALLET_CREDIT',
      amount: new Prisma.Decimal('95000.00'),
      walletId,
      contractId,
      escrowId,
      idempotencyKey: `escrow:${escrowId}:release`,
    }),
  }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'RELEASED', releasedAmount: new Prisma.Decimal('95000.00'), releasedAt: expect.any(Date) },
  }));
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith({
    where: { contractId },
    data: { workStatus: 'RELEASED' },
  });
});

test('repeated release is idempotent and does not credit again', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord({ status: 'RELEASED', releasedAmount: '95000.00', releasedAt: new Date() }));

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('Contract funds were already released');
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('release rejects an escrow that is not release eligible', async () => {
  mockPrisma.escrow.findUnique.mockResolvedValue(escrowRecord({ status: 'FUNDED' }));

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(409);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});

test('release requires a seeker wallet and never creates one implicitly', async () => {
  mockPrisma.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([{ id: escrowId }])
    .mockResolvedValueOnce([]);

  const response = await request(app)
    .post(`/api/admin/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(409);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(mockPrisma.financialLedgerEntry.create).not.toHaveBeenCalled();
});
