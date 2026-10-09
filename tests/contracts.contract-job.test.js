import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { validateContractPayment } from '../src/validators/contract.validation.js';

const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondApplicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const freelanceContractId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const escrowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const paymentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const providerReference = 'contract-job-reference';

const contractJobApplication = ({ status = 'SHORTLISTED', id = applicationId, selectedSeekerId = seekerId } = {}) => ({
  id,
  seekerId: selectedSeekerId,
  status,
  contract: null,
  job: {
    id: jobId,
    employerId,
    status: 'APPROVED',
    jobType: 'NORMAL_EMPLOYMENT',
    engagementType: 'CONTRACT',
    contractCompensation: {
      amount: new Prisma.Decimal('500000.00'),
      currency: 'NGN',
      duration: '30 days',
      startMode: 'SCHEDULED',
      scheduledStartDate: new Date('2026-10-01T00:00:00.000Z'),
      expectedCompletionDate: new Date('2026-10-31T00:00:00.000Z'),
    },
  },
});

const contractRecord = ({ status = 'PENDING', escrowStatus = 'UNFUNDED', amountValue = '500000.00', feePercentageValue = '5.00', legacyDeducted = false } = {}) => {
  const amount = new Prisma.Decimal(amountValue);
  const feePercentage = new Prisma.Decimal(feePercentageValue);
  const feeAmount = amount.mul(feePercentage).dividedBy(100).toDecimalPlaces(2);
  const seekerEntitlement = legacyDeducted ? amount.minus(feeAmount) : amount;
  return ({
  id: contractId,
  applicationId,
  jobId,
  employerId,
  seekerId,
  type: 'CONTRACT_PROJECT',
  status,
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  expectedEndDate: new Date('2026-10-31T00:00:00.000Z'),
  createdAt: new Date('2026-09-11T10:00:00.000Z'),
  updatedAt: new Date('2026-09-11T10:00:00.000Z'),
  job: { id: jobId, title: 'Build company website' },
  employer: { id: employerId, firstName: 'Employer', lastName: 'One', email: 'employer@example.com' },
  seeker: { id: seekerId, firstName: 'Seeker', lastName: 'One' },
  freelanceDetails: {
    id: freelanceContractId,
    agreedAmount: amount,
    currency: 'NGN',
    platformFeePercentage: feePercentage,
    platformFeeAmount: feeAmount,
    seekerNetAmount: seekerEntitlement,
    employerConfirmedAt: null,
    seekerConfirmedAt: null,
    employerCompletionConfirmedAt: null,
    completionSubmittedAt: null,
    completionNote: null,
    workStatus: 'PENDING',
    escrow: {
      id: escrowId,
      grossAmount: amount,
      platformFeeAmount: feeAmount,
      seekerNetAmount: seekerEntitlement,
      currency: 'NGN',
      fundedAmount: escrowStatus === 'FUNDED' ? new Prisma.Decimal('500000.00') : new Prisma.Decimal('0.00'),
      releasedAmount: new Prisma.Decimal('0.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      status: escrowStatus,
      fundedAt: escrowStatus === 'FUNDED' ? new Date() : null,
      releaseEligibleAt: null,
      payments: escrowStatus === 'FUNDED' ? [{ id: paymentId, amount: new Prisma.Decimal('525000.00'), currency: 'NGN', status: 'SUCCESSFUL', paymentType: 'CONTRACT_FUNDING', verifiedAt: new Date(), createdAt: new Date() }] : [],
    },
  },
  });
};

const payment = ({ status = 'PENDING' } = {}) => ({
  id: paymentId,
  escrowId,
  providerReference,
  transactionId: null,
  idempotencyKey: 'contract-job-payment-key',
  amount: new Prisma.Decimal('525000.00'),
  currency: 'NGN',
  status,
  paymentType: 'CONTRACT_FUNDING',
  provider: 'FLUTTERWAVE',
  metadata: { contractId },
  verifiedAt: null,
  createdAt: new Date(),
});

const mockPrisma = {
  application: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  contract: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  freelanceContract: { update: jest.fn() },
  escrow: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  financialLedgerEntry: { createMany: jest.fn() },
  wallet: { update: jest.fn() },
  platformFeeConfiguration: { findUnique: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};
let storedPayment;

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/flutterwave.service.js', () => ({
  initializeFlutterwavePayment: jest.fn(),
  verifyFlutterwaveTransaction: jest.fn(),
}));

const { selectContractJobApplication, updateEmployerApplicationStatus } = await import('../src/services/employerApplications.service.js');
const { initializeFlutterwavePayment, verifyFlutterwaveTransaction } = await import('../src/services/flutterwave.service.js');
const { initializeContractPayment, verifyContractPayment } = await import('../src/services/contractPayment.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  storedPayment = null;
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: applicationId }]);
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({ percentage: new Prisma.Decimal('5.00'), isActive: true });
  mockPrisma.contract.create.mockResolvedValue({ id: contractId });
  mockPrisma.escrow.create.mockResolvedValue({ id: escrowId, status: 'UNFUNDED' });
  mockPrisma.application.update.mockResolvedValue({});
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  mockPrisma.contract.findFirst.mockResolvedValue(null);
  mockPrisma.payment.create.mockImplementation(async ({ data }) => {
    storedPayment = { ...payment(), ...data };
    return storedPayment;
  });
  mockPrisma.payment.findUnique.mockImplementation(async () => storedPayment ?? payment());
  mockPrisma.payment.update.mockImplementation(async ({ data }) => {
    storedPayment = { ...(storedPayment ?? payment()), ...data };
    return storedPayment;
  });
  mockPrisma.escrow.findUnique.mockResolvedValue({ id: escrowId, status: 'UNFUNDED', grossAmount: new Prisma.Decimal('500000.00'), platformFeeAmount: new Prisma.Decimal('25000.00'), seekerNetAmount: new Prisma.Decimal('500000.00') });
  mockPrisma.escrow.update.mockResolvedValue({});
  mockPrisma.contract.update.mockResolvedValue({});
  mockPrisma.application.updateMany.mockResolvedValue({ count: 1 });
  initializeFlutterwavePayment.mockResolvedValue({ checkoutUrl: 'https://checkout.test', providerReference });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, amount: 525000, currency: 'NGN', status: 'successful' });
});

test('contract selection creates protected engagement and leaves application payment pending', async () => {
  mockPrisma.application.findFirst.mockResolvedValue(contractJobApplication());
  const result = await selectContractJobApplication(employerId, jobId, applicationId);

  expect(mockPrisma.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CONTRACT_PROJECT', status: 'PENDING' }) }));
  expect(mockPrisma.contract.create.mock.calls[0][0].data.freelanceDetails.create).toEqual(expect.objectContaining({
    agreedAmount: new Prisma.Decimal('500000.00'),
    platformFeePercentage: new Prisma.Decimal('5.00'),
    platformFeeAmount: new Prisma.Decimal('25000.00'),
    seekerNetAmount: new Prisma.Decimal('500000.00'),
  }));
  expect(mockPrisma.escrow.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      freelanceContractId: contractId,
      grossAmount: new Prisma.Decimal('500000.00'),
      platformFeeAmount: new Prisma.Decimal('25000.00'),
      seekerNetAmount: new Prisma.Decimal('500000.00'),
      status: 'UNFUNDED',
    }),
  }));
  expect(mockPrisma.application.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAYMENT_PENDING' } }));
  expect(result.status).toBe('PAYMENT_PENDING');
});

test('a changed admin percentage is snapshotted for new contracts and does not reprice an existing contract', async () => {
  mockPrisma.application.findFirst.mockResolvedValue(contractJobApplication());
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValueOnce({ percentage: new Prisma.Decimal('7.50'), isActive: true });

  await selectContractJobApplication(employerId, jobId, applicationId);

  expect(mockPrisma.contract.create.mock.calls[0][0].data.freelanceDetails.create).toEqual(expect.objectContaining({
    platformFeePercentage: new Prisma.Decimal('7.50'),
    platformFeeAmount: new Prisma.Decimal('37500.00'),
    seekerNetAmount: new Prisma.Decimal('500000.00'),
  }));

  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  mockPrisma.platformFeeConfiguration.findUnique.mockResolvedValue({ percentage: new Prisma.Decimal('10.00'), isActive: true });
  await initializeContractPayment({ contractId, employerId, idempotencyKey: 'existing-snapshot-key' });

  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal('525000.00') }),
  }));
  expect(mockPrisma.platformFeeConfiguration.findUnique).toHaveBeenCalledTimes(1);
});

test('contract selection rejects a non-owned application', async () => {
  mockPrisma.application.findFirst.mockResolvedValue(null);
  await expect(selectContractJobApplication(employerId, jobId, applicationId)).rejects.toMatchObject({ status: 404 });
  expect(mockPrisma.contract.create).not.toHaveBeenCalled();
});

test('second Contract Job candidate selection fails before creating another engagement', async () => {
  mockPrisma.application.findFirst.mockResolvedValueOnce(contractJobApplication());
  await selectContractJobApplication(employerId, jobId, applicationId);

  const contractCreateCount = mockPrisma.contract.create.mock.calls.length;
  const escrowCreateCount = mockPrisma.escrow.create.mock.calls.length;
  mockPrisma.application.findFirst.mockResolvedValueOnce(contractJobApplication({ id: secondApplicationId, selectedSeekerId: '33333333-3333-4333-8333-333333333334' }));
  mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: contractId, applicationId });

  await expect(selectContractJobApplication(employerId, jobId, secondApplicationId)).rejects.toMatchObject({
    status: 409,
    message: 'Another candidate has already been selected for this job.',
  });
  expect(mockPrisma.contract.create).toHaveBeenCalledTimes(contractCreateCount);
  expect(mockPrisma.escrow.create).toHaveBeenCalledTimes(escrowCreateCount);
});

test('simultaneous Contract Job selections serialize to one selected candidate', async () => {
  const applications = {
    [applicationId]: contractJobApplication(),
    [secondApplicationId]: contractJobApplication({ id: secondApplicationId, selectedSeekerId: '33333333-3333-4333-8333-333333333334' }),
  };
  let selectedApplicationId = null;
  let transactionTail = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const transaction = transactionTail.then(() => callback(mockPrisma));
    transactionTail = transaction.catch(() => undefined);
    return transaction;
  });
  mockPrisma.application.findFirst.mockImplementation(async ({ where }) => applications[where.id]);
  mockPrisma.contract.findFirst.mockImplementation(async () => selectedApplicationId ? { id: contractId, applicationId: selectedApplicationId } : null);
  mockPrisma.contract.create.mockImplementation(async ({ data }) => {
    selectedApplicationId = data.applicationId;
    return { id: contractId };
  });

  const results = await Promise.allSettled([
    selectContractJobApplication(employerId, jobId, applicationId),
    selectContractJobApplication(employerId, jobId, secondApplicationId),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(mockPrisma.contract.create).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.create).toHaveBeenCalledTimes(1);
  expect(selectedApplicationId).toBeTruthy();
});

test('generic ACCEPTED status cannot bypass Contract Job payment selection', async () => {
  mockPrisma.application.findFirst
    .mockResolvedValueOnce({ id: applicationId })
    .mockResolvedValueOnce(contractJobApplication());

  await expect(updateEmployerApplicationStatus(employerId, jobId, applicationId, 'ACCEPTED'))
    .rejects.toMatchObject({ status: 409 });
  expect(mockPrisma.application.update).not.toHaveBeenCalled();
  expect(mockPrisma.contract.create).not.toHaveBeenCalled();
});

test('contract payment initialization uses the snapshot amount and does not use a separate escrow system', async () => {
  const result = await initializeContractPayment({
    contractId,
    employerId,
    idempotencyKey: 'contract-job-payment-key',
    amount: 100000,
    percentage: 1,
    total: 100000,
  });
  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: new Prisma.Decimal('525000.00'), currency: 'NGN', paymentType: 'CONTRACT_FUNDING' }) }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '525000.00', currency: 'NGN' }));
  expect(initializeFlutterwavePayment.mock.calls[0][0].meta).toEqual(expect.objectContaining({ projectAmount: '500000.00', platformFeeAmount: '25000.00' }));
  expect(result.fundingBreakdown).toEqual({
    projectAmount: '500000.00',
    fundingPercentage: '5.00',
    fundingCharge: '25000.00',
    totalEmployerPayment: '525000.00',
    seekerEntitlement: '500000.00',
    currency: 'NGN',
  });
  expect(result.payment.checkoutUrl).toBe('https://checkout.test');
});

test('freelance project payment initialization adds the snapshotted fee to the project amount', async () => {
  const freelanceContract = contractRecord({ status: 'ACTIVE' });
  freelanceContract.type = 'FREELANCE_PROJECT';
  mockPrisma.contract.findUnique.mockResolvedValue(freelanceContract);

  const result = await initializeContractPayment({
    contractId,
    employerId,
    idempotencyKey: 'freelance-additive-payment-key',
  });

  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      amount: new Prisma.Decimal('525000.00'),
      currency: 'NGN',
      paymentType: 'CONTRACT_FUNDING',
    }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '525000.00', currency: 'NGN' }));
  expect(result.fundingBreakdown).toEqual(expect.objectContaining({
    projectAmount: '500000.00',
    fundingCharge: '25000.00',
    totalEmployerPayment: '525000.00',
    seekerEntitlement: '500000.00',
  }));
});

test('new pending freelance project can initialize funding before candidate confirmation', async () => {
  const freelanceContract = contractRecord({ status: 'PENDING' });
  freelanceContract.type = 'FREELANCE_PROJECT';
  mockPrisma.contract.findUnique.mockResolvedValue(freelanceContract);

  const result = await initializeContractPayment({
    contractId,
    employerId,
    idempotencyKey: 'pending-freelance-funding-key',
  });

  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      amount: new Prisma.Decimal('525000.00'),
      currency: 'NGN',
      paymentType: 'CONTRACT_FUNDING',
    }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({
    amount: '525000.00',
    currency: 'NGN',
  }));
  expect(result.payment.checkoutUrl).toBe('https://checkout.test');
});

test.each([
  ['5.00', '10000.00', '210000.00'],
  ['10.00', '20000.00', '220000.00'],
])('uses the saved additive funding snapshot for a 200000 project at %s percent', async (percentage, fee, total) => {
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord({
    amountValue: '200000.00',
    feePercentageValue: percentage,
  }));

  const result = await initializeContractPayment({
    contractId,
    employerId,
    idempotencyKey: `additive-${percentage}`,
  });

  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal(total) }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: total, currency: 'NGN' }));
  expect(result.fundingBreakdown).toEqual({
    projectAmount: '200000.00',
    fundingPercentage: percentage,
    fundingCharge: fee,
    totalEmployerPayment: total,
    seekerEntitlement: '200000.00',
    currency: 'NGN',
  });
});

test('historical deducted funding snapshots are not repriced or converted to additive terms', async () => {
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord({
    amountValue: '200000.00',
    feePercentageValue: '5.00',
    legacyDeducted: true,
  }));

  const result = await initializeContractPayment({
    contractId,
    employerId,
    idempotencyKey: 'legacy-deducted-snapshot',
  });

  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '200000.00', currency: 'NGN' }));
  expect(result.fundingBreakdown).toEqual(expect.objectContaining({
    projectAmount: '200000.00',
    fundingCharge: '10000.00',
    totalEmployerPayment: '200000.00',
    seekerEntitlement: '190000.00',
  }));
});

test('payment request validation rejects client-supplied amount and fee fields', () => {
  const req = {
    body: {
      idempotencyKey: 'client-key',
      agreedAmount: 100000,
      platformFeePercentage: 1,
      platformFeeAmount: 1000,
      seekerNetAmount: 99000,
      amount: 100000,
      total: 100000,
      currency: 'USD',
      employerId: 'attacker-employer',
      seekerId: 'attacker-seeker',
      status: 'SUCCESSFUL',
      escrowAmount: 100000,
    },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  validateContractPayment(req, res, next);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(next).not.toHaveBeenCalled();
});

test('concurrent initialization calls share one provider checkout claim', async () => {
  let resolveProvider;
  let transactionTail = Promise.resolve();
  mockPrisma.$transaction.mockImplementation((callback) => {
    const transaction = transactionTail.then(() => callback(mockPrisma));
    transactionTail = transaction.catch(() => undefined);
    return transaction;
  });
  mockPrisma.contract.findUnique.mockImplementation(async () => {
    const record = contractRecord();
    if (storedPayment) record.freelanceDetails.escrow.payments = [storedPayment];
    return record;
  });
  initializeFlutterwavePayment.mockImplementationOnce(() => new Promise((resolve) => { resolveProvider = resolve; }));

  const first = initializeContractPayment({ contractId, employerId, idempotencyKey: 'shared-init-key' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'shared-init-key' });

  expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
  expect(initializeFlutterwavePayment).toHaveBeenCalledTimes(1);
  expect(second.payment.checkoutUrl).toBeNull();
  resolveProvider({ checkoutUrl: 'https://checkout.test', providerReference });
  const firstResult = await first;
  expect(firstResult.payment.checkoutUrl).toBe('https://checkout.test');
});

test('definitive checkout initialization failure releases the claim for a safe retry', async () => {
  mockPrisma.contract.findUnique.mockImplementation(async () => {
    const record = contractRecord();
    if (storedPayment) record.freelanceDetails.escrow.payments = [storedPayment];
    return record;
  });
  initializeFlutterwavePayment.mockRejectedValueOnce(new Error('provider rejected checkout'));

  await expect(initializeContractPayment({ contractId, employerId, idempotencyKey: 'retry-init-key' }))
    .rejects.toThrow('provider rejected checkout');
  expect(storedPayment.status).toBe('PENDING');
  expect(storedPayment.metadata.checkoutInitialization).toBeUndefined();

  const retried = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'retry-init-key' });

  expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
  expect(initializeFlutterwavePayment).toHaveBeenCalledTimes(2);
  expect(retried.payment.checkoutUrl).toBe('https://checkout.test');
});

test('checkout initialization with an unknown provider outcome retains its claim', async () => {
  mockPrisma.contract.findUnique.mockImplementation(async () => {
    const record = contractRecord();
    if (storedPayment) record.freelanceDetails.escrow.payments = [storedPayment];
    return record;
  });
  initializeFlutterwavePayment.mockRejectedValueOnce(Object.assign(new Error('network timeout'), { outcomeUnknown: true }));

  await expect(initializeContractPayment({ contractId, employerId, idempotencyKey: 'unknown-outcome-key' }))
    .rejects.toThrow('network timeout');
  expect(storedPayment.metadata.checkoutInitialization).toBeTruthy();

  const retry = await initializeContractPayment({ contractId, employerId, idempotencyKey: 'unknown-outcome-key' });

  expect(initializeFlutterwavePayment).toHaveBeenCalledTimes(1);
  expect(retry.payment.checkoutUrl).toBeNull();
});

test('verified contract payment funds escrow and finalizes application acceptance atomically', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } });
  mockPrisma.contract.findUnique.mockResolvedValue(contractRecord());
  const result = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });

  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESSFUL' }) }));
  expect(mockPrisma.escrow.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FUNDED' }) }));
  expect(mockPrisma.contract.update).toHaveBeenCalledWith({ where: { id: contractId }, data: { status: 'ACTIVE' } });
  expect(mockPrisma.application.updateMany).toHaveBeenCalledWith({ where: { id: applicationId, status: 'PAYMENT_PENDING' }, data: { status: 'ACCEPTED' } });
  const ledgerEntries = mockPrisma.financialLedgerEntry.createMany.mock.calls[0][0].data;
  expect(ledgerEntries.map(({ entryType, amount }) => [entryType, amount.toFixed(2)])).toEqual([
    ['EMPLOYER_PAYMENT', '525000.00'],
    ['ESCROW_FUNDED', '500000.00'],
    ['PLATFORM_FEE', '25000.00'],
  ]);
  expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
  expect(result.payment.status).toBe('SUCCESSFUL');
});

test('a zero-percent snapshot charges only the project amount', async () => {
  const zeroFeeContract = contractRecord();
  zeroFeeContract.freelanceDetails.platformFeePercentage = new Prisma.Decimal('0.00');
  zeroFeeContract.freelanceDetails.platformFeeAmount = new Prisma.Decimal('0.00');
  zeroFeeContract.freelanceDetails.escrow.platformFeeAmount = new Prisma.Decimal('0.00');
  mockPrisma.contract.findUnique.mockResolvedValue(zeroFeeContract);

  await initializeContractPayment({ contractId, employerId, idempotencyKey: 'zero-fee-payment-key' });

  expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ amount: new Prisma.Decimal('500000.00') }),
  }));
  expect(initializeFlutterwavePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: '500000.00' }));
});

test('pending provider status remains recoverable instead of becoming failed', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } });
  mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } })
    .mockResolvedValue(contractRecord());
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, status: 'pending' });

  const result = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });

  expect(result.pending).toBe(true);
  expect(result.payment.status).toBe('PROCESSING');
  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PROCESSING' }),
  }));
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('a provider-confirmed terminal failure is marked failed and remains unfunded', async () => {
  mockPrisma.contract.findFirst
    .mockResolvedValueOnce({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } })
    .mockResolvedValue(contractRecord());
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, status: 'failed' });

  await expect(verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' }))
    .rejects.toMatchObject({ status: 422 });

  expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('wrong provider amount does not finalize a Contract Job', async () => {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [payment()] } } });
  verifyFlutterwaveTransaction.mockResolvedValue({ id: 456789, tx_ref: providerReference, amount: 500000, currency: 'NGN', status: 'successful' });
  await expect(verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' })).rejects.toMatchObject({ status: 422 });
  expect(mockPrisma.application.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
});

test('a late failed verification cannot downgrade a successful funded payment', async () => {
  let currentPayment = payment();
  let escrowStatus = 'UNFUNDED';
  let resolveStaleVerification;
  mockPrisma.contract.findFirst.mockImplementation(async ({ select }) => select?.applicationId
    ? contractRecord()
    : { id: contractId, employerId, freelanceDetails: { escrow: { id: escrowId, payments: [currentPayment] } } });
  mockPrisma.payment.findUnique.mockImplementation(async () => currentPayment);
  mockPrisma.payment.update.mockImplementation(async ({ data }) => {
    currentPayment = { ...currentPayment, ...data };
    return currentPayment;
  });
  mockPrisma.escrow.findUnique.mockImplementation(async () => ({
    id: escrowId,
    status: escrowStatus,
    grossAmount: new Prisma.Decimal('500000.00'),
    platformFeeAmount: new Prisma.Decimal('25000.00'),
    seekerNetAmount: new Prisma.Decimal('500000.00'),
  }));
  mockPrisma.escrow.update.mockImplementation(async ({ data }) => {
    escrowStatus = data.status;
    return {};
  });

  verifyFlutterwaveTransaction.mockImplementationOnce(() => new Promise((resolve) => { resolveStaleVerification = resolve; }));
  const staleVerification = verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });
  await new Promise((resolve) => setImmediate(resolve));
  verifyFlutterwaveTransaction.mockResolvedValueOnce({ id: 456789, tx_ref: providerReference, amount: 525000, currency: 'NGN', status: 'successful' });
  await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });
  resolveStaleVerification({ id: 456789, tx_ref: providerReference, amount: 500000, currency: 'NGN', status: 'failed' });
  const staleResult = await staleVerification;

  expect(staleResult.payment.status).toBe('SUCCESSFUL');
  expect(currentPayment.status).toBe('SUCCESSFUL');
  expect(escrowStatus).toBe('FUNDED');
  expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.escrow.update).toHaveBeenCalledTimes(1);
  expect(mockPrisma.financialLedgerEntry.createMany).toHaveBeenCalledTimes(1);
  const repeat = await verifyContractPayment({ contractId, employerId, providerReference, transactionId: '456789' });
  expect(repeat.payment.status).toBe('SUCCESSFUL');
  expect(verifyFlutterwaveTransaction).toHaveBeenCalledTimes(2);
  expect(mockPrisma.financialLedgerEntry.createMany).toHaveBeenCalledTimes(1);
});
