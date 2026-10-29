import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: {} }));
const { transitionConversionOperation } = await import('../src/services/conversionOperation.service.js');

const createTransaction = (updateCount = 1) => ({
  conversionOperation: {
    updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
  },
  conversionOperationEvent: {
    create: jest.fn().mockResolvedValue({ id: 'event-id' }),
  },
});

test('uncertain outcomes use compare-and-set and append a durable reconciliation event', async () => {
  const transaction = createTransaction();
  await transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'SUBMITTED',
    toStatus: 'UNCERTAIN',
    eventType: 'PROVIDER_OUTCOME_UNKNOWN',
    reason: 'Provider request timed out',
  });

  expect(transaction.conversionOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'operation-id', status: 'SUBMITTED' },
    data: expect.objectContaining({ status: 'UNCERTAIN', reconciliationAttempts: { increment: 1 } }),
  }));
  expect(transaction.conversionOperationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ fromStatus: 'SUBMITTED', toStatus: 'UNCERTAIN', eventType: 'PROVIDER_OUTCOME_UNKNOWN' }),
  }));
});

test('conversion cannot be marked confirmed without an atomic settlement finalizer', async () => {
  const transaction = createTransaction();

  await expect(transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'SUBMITTED',
    toStatus: 'CONFIRMED',
    eventType: 'SETTLEMENT_CONFIRMED',
  })).rejects.toMatchObject({ status: 503, code: 'CONVERSION_FINALIZATION_DISABLED' });
  expect(transaction.conversionOperation.updateMany).not.toHaveBeenCalled();
});

test('concurrent or stale state claims cannot append a false transition event', async () => {
  const transaction = createTransaction(0);

  await expect(transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'SUBMITTED',
    toStatus: 'UNCERTAIN',
    eventType: 'PROVIDER_OUTCOME_UNKNOWN',
  })).rejects.toMatchObject({ status: 409, code: 'CONVERSION_OPERATION_STATE_CONFLICT' });
  expect(transaction.conversionOperationEvent.create).not.toHaveBeenCalled();
});

test('even settlement evidence cannot bypass the disabled atomic finalizer', async () => {
  const transaction = createTransaction();
  await expect(transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'SUBMITTED',
    toStatus: 'CONFIRMED',
    eventType: 'SETTLEMENT_CONFIRMED',
    providerReference: 'provider-settlement-1',
    metadata: { settlementConfirmed: true, convertedAmount: '82.50' },
  })).rejects.toMatchObject({ code: 'CONVERSION_FINALIZATION_DISABLED' });

  expect(transaction.conversionOperation.updateMany).not.toHaveBeenCalled();
});

test('resolving an uncertain outcome records reconciliation time and increments recovery attempts', async () => {
  const transaction = createTransaction();
  await transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'UNCERTAIN',
    toStatus: 'FAILED',
    eventType: 'RECONCILIATION_CONFIRMED_FAILURE',
    reason: 'Provider confirms the original request failed',
  });

  expect(transaction.conversionOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      status: 'FAILED',
      lastReconciledAt: expect.any(Date),
      reconciliationAttempts: { increment: 1 },
    }),
  }));
});

test('terminal operation states cannot be retried', async () => {
  const transaction = createTransaction();

  await expect(transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'FAILED',
    toStatus: 'SUBMITTED',
    eventType: 'RETRY',
  })).rejects.toThrow('Invalid conversion operation transition');
  expect(transaction.conversionOperation.updateMany).not.toHaveBeenCalled();
});

test('disabled conversion execution cannot progress from blocked to a quote', async () => {
  const transaction = createTransaction();

  await expect(transitionConversionOperation(transaction, {
    operationId: 'operation-id',
    expectedStatus: 'BLOCKED',
    toStatus: 'QUOTED',
    eventType: 'QUOTE_REQUESTED',
  })).rejects.toMatchObject({ status: 503, code: 'CONVERSION_EXECUTION_DISABLED' });
  expect(transaction.conversionOperation.updateMany).not.toHaveBeenCalled();
});
