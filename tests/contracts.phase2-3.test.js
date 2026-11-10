import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const paymentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const providerReference = 'leamjobs_contract_ref';

const payment = ({ status = 'PENDING' } = {}) => ({
  id: paymentId,
  userId: '11111111-1111-4111-8111-111111111111',
  escrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'payment-key',
  amount: new Prisma.Decimal('100000.00'),
  currency: 'NGN',
  status,
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  metadata: { contractId },
  verifiedAt: null,
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
});
const contract = ({ escrowStatus = 'UNFUNDED', completionSubmittedAt = null, completionNote = null } = {}) => ({
  id: contractId,
  applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employerId,
  seekerId,
  type: 'FREELANCE_PROJECT',
  status: 'ACTIVE',
  job: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Freelance project',
    jobType: 'FREELANCE_PROJECT',
    engagementType: 'FREELANCE',
  },
  employer: { email: 'employer@example.com' },
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  freelanceDetails: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    agreedAmount: new Prisma.Decimal('100000.00'),
    currency: 'NGN',
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('5000.00'),
    seekerNetAmount: new Prisma.Decimal('95000.00'),
    employerConfirmedAt: new Date('2026-09-11T09:00:00.000Z'),
    seekerConfirmedAt: new Date('2026-09-11T09:30:00.000Z'),
    employerCompletionConfirmedAt: null,
    completionSubmittedAt,
    completionNote,
    workStatus: completionSubmittedAt ? 'COMPLETION_SUBMITTED' : 'IN_PROGRESS',
    escrow: {
      id: escrowId,
      grossAmount: new Prisma.Decimal('100000.00'),
      platformFeeAmount: new Prisma.Decimal('5000.00'),
      seekerNetAmount: new Prisma.Decimal('95000.00'),
      currency: 'NGN',
      fundedAmount: escrowStatus === 'FUNDED' ? new Prisma.Decimal('100000.00') : new Prisma.Decimal('0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: escrowStatus === 'FUNDED' ? new Date('2026-09-11T11:00:00.000Z') : null,
      releaseEligibleAt: null,
      payments: escrowStatus === 'FUNDED' ? [payment({ status: 'SUCCESSFUL' })] : [],
    },
  },
});

const mockPrisma = {
  contract: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  escrow: { findUnique: jest.fn(), update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  adminAccount: { findMany: jest.fn() },
  adminPermission: { findMany: jest.fn() },
  financialLedgerEntry: { createMany: jest.fn() },
  wallet: { upsert: jest.fn().mockResolvedValue({ id: 'usd-wallet', currency: 'USD' }) },
  providerWebhookEvent: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};
let storedPayment;

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
  assertFlutterwaveWebhookSignature: jest.fn(),
}));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }),
}));

const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { createNotification } = await import('../src/services/notification.service.js');
const { initializeContractPayment, verifyContractPayment } = await import('../src/services/contractPayment.service.js');
const { submitContractCompletion, confirmContractCompletion } = await import('../src/services/contract.service.js');
const { env } = await import('../src/config/env.js');

beforeEach(() => {
  jest.clearAllMocks();
  env.LEAMJOBS_FREELANCE_PAYMENTS_ENABLED = true;
  env.LEAMJOBS_FREELANCE_CONTRACT_FUNDING_ENABLED = true;
  env.LEAMJOBS_FREELANCE_ESCROW_RELEASE_ENABLED = true;
  env.LEAMJOBS_FREELANCE_WITHDRAWALS_ENABLED = true;
  storedPayment = null;
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: contractId }]);
  mockPrisma.contract.findUnique.mockResolvedValue(contract());
  mockPrisma.contract.findFirst.mockResolvedValue(contract());
  mockPrisma.adminPermission.findMany.mockResolvedValue([
    { key: 'notifications.view', isEnabled: true },
    { key: 'contracts.view', isEnabled: true },
    { key: 'finance.contractFunding.view', isEnabled: true },
  ]);
  mockPrisma.adminAccount.findMany.mockResolvedValue([{
    userId: 'admin-1',
    tier: 'STAFF_ADMIN',
    grants: [
      { permissionKey: 'notifications.view', permission: { isEnabled: true } },
      { permissionKey: 'contracts.view', permission: { isEnabled: true } },
      { permissionKey: 'finance.contractFunding.view', permission: { isEnabled: true } },
    ],
  }]);
  createNotification.mockResolvedValue({ id: 'notification-1' });
  mockPrisma.payment.create.mockImplementation(async ({ data }) => {
    storedPayment = { ...payment(), ...data };
    return storedPayment;
  });
  mockPrisma.payment.update.mockImplementation(async ({ data }) => {
    storedPayment = { ...(storedPayment ?? payment()), ...data };
    return storedPayment;
  });
  mockPrisma.payment.findUnique.mockImplementation(async () => storedPayment ?? payment());
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', currency: 'NGN', grossAmount: new Prisma.Decimal('100000.00'), platformFeeAmount: new Prisma.Decimal('5000.00'), seekerNetAmount: new Prisma.Decimal('95000.00') });
  mockPrisma.escrow.update.mockResolvedValue(undefined);
  mockPrisma.freelanceContract.update.mockResolvedValue(undefined);
  initializeFlutterwavePayment.mockImplementation(async ({ txRef }) => ({
    checkoutUrl: 'https://checkout.test',
    providerReference: txRef,
  }));
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 987654, tx_ref: providerReference, amount: 100000, currency: 'NGN', status: 'successful' });
});

test('payment initialization uses server-side gross amount and currency', async () => {
  const result = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'payment-key' });
  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal('100000.00'), currency: 'NGN', status: 'PENDING', paymentType: 'CONTRACT_FUNDING', provider: 'FLUTTERWAVE' }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '100000.00', currency: 'NGN' }));
  expect(result.payment.checkoutUrl).toBe('https://checkout.test');
});

test('USD contract collection fails closed until an approved Flutterwave method is configured', async () => {
  const usdContract = contract();
  usdContract.freelanceDetails.currency = 'USD';
  usdContract.freelanceDetails.escrow.currency = 'USD';
  mockPrisma.contract.findUnique.mockResolvedValue(usdContract);

  await expect(initializeContractPayment({ contractId, employerId, idempotencyKey: 'usd-payment-key' }))
    .rejects.toMatchObject({ status: 503, code: 'FLUTTERWAVE_USD_COLLECTION_UNAVAILABLE' });
  expect(mockPrisma.wallet.upsert).not.toHaveBeenCalled();
  expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  expect(initializeFlutterwavePayment).not.toHaveBeenCalled();
});

test('wrong employer cannot initialize payment', async () => {
  mockPrisma.contract.findUnique.mockResolvedValue(contract());
  await expect(initializeContractPayment({ contractId, employerId: seekerId })).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.payment.create).not.toHaveBeenCalled();
});

test('verified payment atomically funds the escrow', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ ...contract(), freelanceDetails: { ...contract().freelanceDetails, escrow: { ...contract().freelanceDetails.escrow, payments: [payment()] } } });
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  const lockedPayment = { ...payment(), escrowId };
  mockPrisma.payment.findUnique.mockResolvedValueOnce(payment()).mockResolvedValueOnce(lockedPayment);
  const result = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '987654' });
  expect(verifyFlutterwaveTransaction).toHaveBeenCalledWith('987654');
  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL', transactionId: '987654' }) }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FUNDED', fundedAmount: new Prisma.Decimal('100000.00') }) }));
  expect(result.payment.status).toBe('SUCCESSFUL');
});

test('verified funding activates a pending freelance contract and starts work', async () => {
  const pending = contract({ escrowStatus: 'UNFUNDED' });
  pending.status = 'PENDING';
  mockPrisma.contract.findFirst.mockResolvedValue({
    ...pending,
    freelanceDetails: {
      ...pending.freelanceDetails,
      escrow: { ...pending.freelanceDetails.escrow, payments: [payment()] },
    },
  });
  mockPrisma.payment.findUnique.mockResolvedValueOnce(payment()).mockResolvedValueOnce({ ...payment(), escrowId });

  const result = await verifyContractPayment({
    contractId,
    employerId,
    providerReference,
    transactionId: '987654',
  });

  expect(mockPrisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: contractId },
    data: { status: 'ACTIVE' },
  }));
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { contractId },
    data: { workStatus: 'IN_PROGRESS' },
  }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FUNDED', fundedAmount: new Prisma.Decimal('100000.00') }),
  }));
  expect(result.payment.status).toBe('SUCCESSFUL');
});

test('wrong provider amount does not fund escrow', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ ...contract(), freelanceDetails: { ...contract().freelanceDetails, escrow: { ...contract().freelanceDetails.escrow, payments: [payment()] } } });
  mockPrisma.payment.findUnique.mockResolvedValue(payment());
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 987654, tx_ref: providerReference, amount: 1, currency: 'NGN', status: 'successful' });
  await expect(verifyContractPayment({ contractId, employerId, providerReference, transactionId: '987654' })).rejects.toMatchObject({ status: 422 });
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('seeker can submit completion only after funded escrow', async () => {
  const funded = contract({ escrowStatus: 'FUNDED' });
  mockPrisma.contract.findUnique.mockResolvedValueOnce(funded).mockResolvedValueOnce({ ...funded, freelanceDetails: { ...funded.freelanceDetails, completionSubmittedAt: new Date(), completionNote: 'Done', workStatus: 'COMPLETION_SUBMITTED' } });
  const result = await submitContractCompletion({ contractId, seekerId, completionNote: 'Done' });
  expect(mockPrisma.freelanceContract.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ completionNote: 'Done', workStatus: 'COMPLETION_SUBMITTED' }) }));
  expect(result.freelance.completionNote).toBe('Done');
});

test('employer confirmation makes funded escrow release eligible', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date(), completionNote: 'Done' });
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      workStatus: 'RELEASE_ELIGIBLE',
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE', releaseEligibleAt: new Date() },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);
  const result = await confirmContractCompletion({ contractId, employerId });
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASE_ELIGIBLE', releaseEligibleAt: expect.any(Date) }) }));
  expect(result.freelance.escrow.status).toBe('RELEASE_ELIGIBLE');
  expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
    recipientUserId: 'admin-1',
    actorUserId: employerId,
    type: 'ALERT',
    category: 'PAYMENT',
    eventKey: `admin:escrow-release-requested:${contractId}`,
    title: 'Payment Release Requested',
    message: expect.stringContaining(providerReference),
    link: `/admin/contracts/${contractId}`,
    metadata: { contractId, paymentId, providerReference },
  }));
  expect(mockPrisma.adminAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      suspendedAt: null,
      user: { role: 'ADMIN', isActive: true },
    }),
  }));
});

test('repeated employer confirmation uses the same idempotent Admin notification event key', async () => {
  const alreadyEligible = contract({ escrowStatus: 'RELEASE_ELIGIBLE', completionSubmittedAt: new Date() });
  alreadyEligible.freelanceDetails.employerCompletionConfirmedAt = new Date();
  alreadyEligible.freelanceDetails.escrow.payments = [payment({ status: 'SUCCESSFUL' })];
  mockPrisma.contract.findUnique.mockResolvedValue(alreadyEligible);

  await confirmContractCompletion({ contractId, employerId });
  await confirmContractCompletion({ contractId, employerId });

  const adminNotifications = createNotification.mock.calls
    .map(([input]) => input)
    .filter((input) => input.eventKey?.startsWith('admin:escrow-release-requested:'));
  expect(adminNotifications).toHaveLength(2);
  expect(new Set(adminNotifications.map(({ eventKey }) => eventKey))).toEqual(new Set([
    `admin:escrow-release-requested:${contractId}`,
  ]));
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('failed employer completion confirmation does not create an Admin release notification', async () => {
  mockPrisma.contract.findUnique.mockResolvedValue(contract({ escrowStatus: 'FUNDED' }));

  await expect(confirmContractCompletion({ contractId, employerId }))
    .rejects.toMatchObject({ status: 409 });

  expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
    eventKey: expect.stringMatching(/^admin:escrow-release-requested:/),
  }));
  expect(mockPrisma.adminAccount.findMany).not.toHaveBeenCalled();
});

test('monthly and non-freelance contracts do not generate Admin escrow release notifications', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date() });
  submitted.job.engagementType = 'MONTHLY';
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE' },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);

  await confirmContractCompletion({ contractId, employerId });

  expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
    eventKey: expect.stringMatching(/^admin:escrow-release-requested:/),
  }));
  expect(mockPrisma.adminAccount.findMany).not.toHaveBeenCalled();
});

test('contract projects with a platform escrow generate Admin release notifications', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date() });
  submitted.type = 'CONTRACT_PROJECT';
  submitted.job.jobType = 'NORMAL_EMPLOYMENT';
  submitted.job.engagementType = 'CONTRACT';
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE' },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);
  mockPrisma.adminAccount.findMany.mockResolvedValue([{
    userId: 'super-admin-1',
    tier: 'SUPER_ADMIN',
    grants: [],
  }]);

  await confirmContractCompletion({ contractId, employerId });

  expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
    recipientUserId: 'super-admin-1',
    eventKey: `admin:escrow-release-requested:${contractId}`,
  }));
});

test('non-platform-held employment contracts do not generate Admin escrow release notifications', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date() });
  submitted.type = 'NORMAL_EMPLOYMENT';
  submitted.job.jobType = 'NORMAL_EMPLOYMENT';
  submitted.job.engagementType = 'MONTHLY';
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE' },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);

  await confirmContractCompletion({ contractId, employerId });

  expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
    eventKey: expect.stringMatching(/^admin:escrow-release-requested:/),
  }));
  expect(mockPrisma.adminAccount.findMany).not.toHaveBeenCalled();
});

test('Admin release notifications exclude Staff without every active view grant', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date() });
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE' },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);
  mockPrisma.adminAccount.findMany.mockResolvedValue([{
    userId: 'staff-without-finance-access',
    tier: 'STAFF_ADMIN',
    grants: [
      { permissionKey: 'notifications.view', permission: { isEnabled: true } },
      { permissionKey: 'contracts.view', permission: { isEnabled: true } },
    ],
  }]);

  await confirmContractCompletion({ contractId, employerId });

  expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
    eventKey: expect.stringMatching(/^admin:escrow-release-requested:/),
  }));
});

test('Admin notification write failure does not roll back employer completion', async () => {
  const submitted = contract({ escrowStatus: 'FUNDED', completionSubmittedAt: new Date() });
  const updatedContract = {
    ...submitted,
    freelanceDetails: {
      ...submitted.freelanceDetails,
      employerCompletionConfirmedAt: new Date(),
      escrow: { ...submitted.freelanceDetails.escrow, status: 'RELEASE_ELIGIBLE' },
    },
  };
  mockPrisma.contract.findUnique.mockResolvedValueOnce(submitted).mockResolvedValueOnce(updatedContract);
  createNotification.mockImplementation(async (input) => {
    if (input.eventKey.startsWith('admin:escrow-release-requested:')) throw new Error('notification storage unavailable');
    return { id: 'notification-1' };
  });
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  const result = await confirmContractCompletion({ contractId, employerId });

  expect(result.freelance.escrow.status).toBe('RELEASE_ELIGIBLE');
  expect(mockPrisma.escrow.update).toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith(
    'Admin payment release notification could not be saved:',
    expect.objectContaining({ contractId, recipientUserId: 'admin-1' }),
  );
  errorSpy.mockRestore();
});
