import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const employerId = '11111111-1111-4111-8111-111111111111';
const otherEmployerId = '22222222-2222-4222-8222-222222222222';
const seekerId = '33333333-3333-4333-8333-333333333333';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const token = (subject = employerId) => jwt.sign({ sub: subject, role: 'EMPLOYER' }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

const contractRecord = ({ owner = employerId, status = 'PENDING', escrowStatus = 'UNFUNDED' } = {}) => ({
  id: contractId,
  applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employerId: owner,
  seekerId,
  type: 'CONTRACT_PROJECT',
  status,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  expectedEndDate: new Date('2026-10-31T00:00:00.000Z'),
  completedAt: null,
  endedAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  job: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', employerId: owner, title: 'Build company website', description: 'Build a website', jobType: 'NORMAL_EMPLOYMENT', engagementType: 'CONTRACT' },
  application: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'PAYMENT_PENDING', createdAt: new Date('2026-09-10T10:00:00.000Z') },
  employer: { id: owner, firstName: 'Employer', lastName: 'One' },
  seeker: { id: seekerId, firstName: 'Seeker', lastName: 'One', seekerProfile: { professionalTitle: 'Engineer', profilePictureUrl: 'https://images.example.test/seeker.png' } },
  freelanceDetails: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    agreedAmount: new Prisma.Decimal('500000.00'),
    currency: 'NGN',
    duration: '30 days',
    startMode: 'IMMEDIATE',
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('25000.00'),
    seekerNetAmount: new Prisma.Decimal('500000.00'),
    employerConfirmedAt: new Date('2026-09-11T11:00:00.000Z'),
    seekerConfirmedAt: new Date('2026-09-11T11:10:00.000Z'),
    employerCompletionConfirmedAt: null,
    completionSubmittedAt: null,
    completionNote: null,
    workStatus: 'IN_PROGRESS',
    expectedCompletionDate: new Date('2026-10-31T00:00:00.000Z'),
    escrow: {
      id: escrowId,
      grossAmount: new Prisma.Decimal('500000.00'),
      platformFeeAmount: new Prisma.Decimal('25000.00'),
      seekerNetAmount: new Prisma.Decimal('500000.00'),
      currency: 'NGN',
      fundedAmount: new Prisma.Decimal(escrowStatus === 'FUNDED' ? '500000.00' : '0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: null,
      releaseEligibleAt: null,
      releasedAt: null,
      cancelledAt: null,
      payments: [{
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        amount: new Prisma.Decimal('525000.00'),
        currency: 'NGN',
        status: 'SUCCESSFUL',
        paymentType: 'CONTRACT_FUNDING',
        provider: 'FLUTTERWAVE',
        providerReference: 'safe-provider-reference',
        verifiedAt: new Date('2026-09-11T11:30:00.000Z'),
        createdAt: new Date('2026-09-11T11:20:00.000Z'),
      }],
    },
  },
});

const eligibleUnfundedContract = () => {
  const contract = contractRecord();
  contract.application.jobId = contract.jobId;
  contract.application.seekerId = contract.seekerId;
  contract.freelanceDetails.contractId = contract.id;
  contract.freelanceDetails.escrow.freelanceContractId = contract.id;
  contract.freelanceDetails.employerConfirmedAt = null;
  contract.freelanceDetails.seekerConfirmedAt = null;
  contract.freelanceDetails.workStatus = 'PENDING';
  contract.freelanceDetails.escrow.payments = [];
  return contract;
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  contract: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  escrow: { update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  payment: { findFirst: jest.fn(), findMany: jest.fn() },
  financialLedgerEntry: { findFirst: jest.fn() },
  financialAuditLog: { findFirst: jest.fn() },
  dispute: { findFirst: jest.fn() },
  providerWebhookEvent: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');
const { canPossiblyCancelContract } = await import('../src/services/contract.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'EMPLOYER' });
  mockPrisma.contract.findMany.mockResolvedValue([contractRecord()]);
  mockPrisma.contract.count.mockResolvedValue(1);
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  mockPrisma.contract.findFirst.mockResolvedValue(contractRecord());
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.financialLedgerEntry.findFirst.mockResolvedValue(null);
  mockPrisma.financialAuditLog.findFirst.mockResolvedValue(null);
  mockPrisma.dispute.findFirst.mockResolvedValue(null);
  mockPrisma.providerWebhookEvent.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: contractId }]);
});

test('employer contract list scopes ownership and returns authoritative additive financial snapshots', async () => {
  const response = await request(app)
    .get('/api/employer/contracts')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { employerId, employerArchivedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: 0,
    take: 20,
  }));
  expect(mockPrisma.contract.count).toHaveBeenCalledWith({ where: { employerId, employerArchivedAt: null } });
  expect(response.body.data.contracts[0]).toEqual(expect.objectContaining({
    type: 'CONTRACT_PROJECT',
    status: 'PENDING',
    job: expect.objectContaining({ title: 'Build company website' }),
    seeker: expect.objectContaining({ professionalTitle: 'Engineer', profilePictureUrl: 'https://images.example.test/seeker.png' }),
    funding: {
      projectAmount: '500000.00',
      percentage: '5.00',
      feeAmount: '25000.00',
      totalEmployerPayment: '525000.00',
      seekerEntitlement: '500000.00',
      currency: 'NGN',
      fundedAmount: '0.00',
      escrowStatus: 'UNFUNDED',
      paymentStatus: 'SUCCESSFUL',
    },
    availableActions: { fund: true, cancel: false, confirmCompletion: false, delete: false },
  }));
});

test('employer contract list supports page, limit, and authoritative contract status filtering', async () => {
  const response = await request(app)
    .get('/api/employer/contracts?page=2&limit=5&status=ACTIVE')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(mockPrisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { employerId, employerArchivedAt: null, status: 'ACTIVE' },
    skip: 5,
    take: 5,
  }));
  expect(mockPrisma.contract.count).toHaveBeenCalledWith({ where: { employerId, employerArchivedAt: null, status: 'ACTIVE' } });
  expect(response.body.data.pagination).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
});

test('management actions reflect the existing funded completion workflow', async () => {
  const submitted = contractRecord({ status: 'ACTIVE', escrowStatus: 'FUNDED' });
  submitted.freelanceDetails.completionSubmittedAt = new Date('2026-10-20T12:00:00.000Z');
  submitted.freelanceDetails.workStatus = 'COMPLETION_SUBMITTED';
  mockPrisma.contract.findMany.mockResolvedValue([submitted]);

  const response = await request(app)
    .get('/api/employer/contracts')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(response.body.data.contracts[0].availableActions).toEqual({ fund: false, cancel: false, confirmCompletion: true, delete: false });
  expect(response.body.data.contracts[0].funding.escrowStatus).toBe('FUNDED');
});

test('employer cannot choose another employer scope or an unsupported status', async () => {
  const wrongOwner = await request(app)
    .get(`/api/employer/contracts?employerId=${otherEmployerId}`)
    .set('Authorization', `Bearer ${token()}`);
  const unsupportedStatus = await request(app)
    .get('/api/employer/contracts?status=RELEASED')
    .set('Authorization', `Bearer ${token()}`);

  expect(wrongOwner.status).toBe(400);
  expect(unsupportedStatus.status).toBe(400);
  expect(mockPrisma.contract.findMany).not.toHaveBeenCalled();
});

test('contract details remain ownership protected and expose safe management fields', async () => {
  const response = await request(app)
    .get(`/api/employer/contracts/${contractId}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(response.body.data.contract.job).toEqual(expect.objectContaining({
    title: 'Build company website',
    description: 'Build a website',
    jobType: 'NORMAL_EMPLOYMENT',
    engagementType: 'CONTRACT',
  }));
  expect(response.body.data.contract.freelance.escrow.payments[0]).toEqual(expect.objectContaining({
    provider: 'FLUTTERWAVE',
    providerReference: 'safe-provider-reference',
  }));

  mockPrisma.contract.findUnique.mockResolvedValueOnce(contractRecord({ owner: otherEmployerId }));
  const foreignContract = await request(app)
    .get(`/api/employer/contracts/${contractId}`)
    .set('Authorization', `Bearer ${token()}`);
  expect(foreignContract.status).toBe(404);
});

test('employer completion confirmation remains ownership protected and employer cannot release escrow', async () => {
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord({ owner: otherEmployerId, escrowStatus: 'FUNDED' }));
  const confirmation = await request(app)
    .post(`/api/employer/contracts/${contractId}/confirm-completion`)
    .set('Authorization', `Bearer ${token()}`);
  const release = await request(app)
    .post(`/api/employer/contracts/${contractId}/release`)
    .set('Authorization', `Bearer ${token()}`);

  expect(confirmation.status).toBe(404);
  expect(release.status).toBe(404);
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('employer can delete an eligible unfunded contract without deleting its financial records', async () => {
  const contract = eligibleUnfundedContract();
  expect(canPossiblyCancelContract(contract)).toBe(true);
  mockPrisma.contract.findFirst.mockResolvedValue(contract);

  const response = await request(app)
    .delete(`/api/employer/contracts/${contractId}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ deleted: true, alreadyDeleted: false });
  expect(mockPrisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: contractId },
    data: { employerArchivedAt: expect.any(Date) },
  }));
  expect(mockPrisma.payment.findFirst).toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('employer deletion is authenticated, ownership scoped, and UUID validated', async () => {
  const unauthenticated = await request(app).delete(`/api/employer/contracts/${contractId}`);
  const invalidId = await request(app)
    .delete('/api/employer/contracts/not-a-uuid')
    .set('Authorization', `Bearer ${token()}`);
  mockPrisma.contract.findFirst.mockResolvedValueOnce(null);
  const foreignContract = await request(app)
    .delete(`/api/employer/contracts/${contractId}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(unauthenticated.status).toBe(401);
  expect(invalidId.status).toBe(400);
  expect(foreignContract.status).toBe(404);
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});

test('employer cannot delete a funded contract whose escrow has not been released', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue(contractRecord({ status: 'ACTIVE', escrowStatus: 'FUNDED' }));

  const response = await request(app)
    .delete(`/api/employer/contracts/${contractId}`)
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(409);
  expect(mockPrisma.contract.update).not.toHaveBeenCalled();
});
