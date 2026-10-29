import { prisma } from '../config/database.js';
import { CONVERSION_EXECUTION_ENABLED } from '../config/walletCurrencies.js';

const TRANSITIONS = Object.freeze({
  BLOCKED: ['QUOTED'],
  QUOTED: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['UNCERTAIN', 'CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED'],
  UNCERTAIN: ['CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
});

export const transitionConversionOperation = async (
  transaction,
  { operationId, expectedStatus, toStatus, eventType, reason = null, actorUserId = null, providerReference = null, metadata = undefined },
) => {
  if (!TRANSITIONS[expectedStatus]?.includes(toStatus)) {
    throw new Error(`Invalid conversion operation transition: ${expectedStatus} -> ${toStatus}`);
  }
  if (['QUOTED', 'SUBMITTED'].includes(toStatus) && !CONVERSION_EXECUTION_ENABLED) {
    const error = new Error('Conversion execution is disabled pending provider and account approval');
    error.status = 503;
    error.code = 'CONVERSION_EXECUTION_DISABLED';
    throw error;
  }
  if (toStatus === 'CONFIRMED') {
    const error = new Error('Confirmed operations require the atomic settlement finalizer, which is disabled');
    error.status = 503;
    error.code = 'CONVERSION_FINALIZATION_DISABLED';
    throw error;
  }

  const update = await transaction.conversionOperation.updateMany({
    where: { id: operationId, status: expectedStatus },
    data: {
      status: toStatus,
      statusReason: reason,
      ...(toStatus === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
      ...(['UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(toStatus)
        || ['UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(expectedStatus)
        ? { reconciliationAttempts: { increment: 1 } }
        : {}),
      ...(['UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(expectedStatus)
        ? { lastReconciledAt: new Date() }
        : {}),
    },
  });
  if (update.count !== 1) {
    const error = new Error('Conversion operation state changed; reload before continuing');
    error.status = 409;
    error.code = 'CONVERSION_OPERATION_STATE_CONFLICT';
    throw error;
  }
  await transaction.conversionOperationEvent.create({
    data: {
      conversionOperationId: operationId,
      actorUserId,
      fromStatus: expectedStatus,
      toStatus,
      eventType,
      reason,
      providerReference,
      ...(metadata ? { metadata } : {}),
    },
  });
};

export const listAdminConversionOperations = async ({ limit = 50, cursor, status, currency, staleMinutes } = {}) => {
  const rows = await prisma.conversionOperation.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(staleMinutes ? { updatedAt: { lt: new Date(Date.now() - staleMinutes * 60 * 1000) } } : {}),
      ...(currency ? {
        OR: [{ sourceCurrency: currency }, { destinationCurrency: currency }],
      } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      escrowId: true,
      seekerId: true,
      sourceCurrency: true,
      destinationCurrency: true,
      sourceAmount: true,
      convertedAmount: true,
      status: true,
      statusReason: true,
      providerTransactionId: true,
      reconciliationAttempts: true,
      createdAt: true,
      updatedAt: true,
      lastReconciledAt: true,
      events: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, actorUserId: true, eventType: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
      },
    },
  });
  const hasNextPage = rows.length > limit;
  const items = (hasNextPage ? rows.slice(0, limit) : rows).map((row) => ({
    ...row,
    sourceAmount: row.sourceAmount.toString(),
    convertedAmount: row.convertedAmount?.toString() ?? null,
  }));
  return { items, nextCursor: hasNextPage ? items[items.length - 1].id : null };
};
