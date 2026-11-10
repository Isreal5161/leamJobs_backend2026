import { prisma } from '../config/database.js';

const reversalEntries = [
  { ledgerEntries: { some: { entryType: 'WITHDRAWAL_SUCCESSFUL' } } },
  { ledgerEntries: { some: { entryType: 'WITHDRAWAL_FAILED_REVERSAL' } } },
];

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const decimalToString = (value) => value?.toString() ?? '0.00';
const amountToCents = (value) => {
  const [whole = '0', fraction = ''] = String(value ?? 0).split('.');
  return (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};
const centsToAmount = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
const hasEntry = (entries, type) => entries.some((entry) => entry.entryType === type);
const matchesLedgerEntry = (withdrawal, entry, entryType, amount) => (
  entry.entryType === entryType
  && Boolean(withdrawal.payout?.id)
  && entry.payoutId === withdrawal.payout.id
  && entry.walletId === withdrawal.walletId
  && entry.currency === withdrawal.currency
  && amountToCents(entry.amount) === amountToCents(amount)
);
const isReversed = (withdrawal) => withdrawal.status === 'FAILED'
  && withdrawal.payout?.status === 'FAILED'
  && amountToCents(withdrawal.payout.amount) === amountToCents(withdrawal.payoutAmount)
  && (withdrawal.ledgerEntries ?? []).some((entry) => matchesLedgerEntry(
    withdrawal,
    entry,
    'WITHDRAWAL_SUCCESSFUL',
    withdrawal.payout.amount,
  ))
  && (withdrawal.ledgerEntries ?? []).some((entry) => matchesLedgerEntry(
    withdrawal,
    entry,
    'WITHDRAWAL_FAILED_REVERSAL',
    withdrawal.amount,
  ));
const isConfirmedSuccessful = (withdrawal) => withdrawal.status === 'SUCCESSFUL'
  && withdrawal.payout?.status === 'SUCCESSFUL'
  && amountToCents(withdrawal.payout.amount) === amountToCents(withdrawal.payoutAmount)
  && (withdrawal.ledgerEntries ?? []).some((entry) => matchesLedgerEntry(
    withdrawal,
    entry,
    'WITHDRAWAL_SUCCESSFUL',
    withdrawal.payout.amount,
  ));

const sanitizeProviderMessage = (message) => {
  if (typeof message !== 'string' || !message.trim()) return null;
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_ -]?key|token|secret|signature|authorization|password)\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
    .replace(/\b\d{7,}\b/g, '[redacted]')
    .slice(0, 500);
};

const searchTokens = (value) => value?.trim().split(/\s+/).filter(Boolean) ?? [];
const seekerTextFilter = (value) => {
  const tokens = searchTokens(value);
  if (!tokens.length) return null;
  if (tokens.length === 1 && isUuid(tokens[0])) return { id: tokens[0] };
  return {
    AND: tokens.map((token) => ({
      OR: [
        { firstName: { contains: token, mode: 'insensitive' } },
        { lastName: { contains: token, mode: 'insensitive' } },
        { email: { contains: token, mode: 'insensitive' } },
      ],
    })),
  };
};

const buildWhere = ({ currency, provider, from, to, search, seeker, status }) => {
  const conditions = [];
  const globalSearch = search?.trim();
  const seekerSearch = seekerTextFilter(seeker);
  if (globalSearch) {
    const clauses = [
      ...(isUuid(globalSearch) ? [{ id: globalSearch }] : []),
      { providerReference: { contains: globalSearch, mode: 'insensitive' } },
      { payout: { is: { OR: [
        { providerReference: { contains: globalSearch, mode: 'insensitive' } },
        { attempts: { some: { providerReference: { contains: globalSearch, mode: 'insensitive' } } } },
      ] } } },
      { seeker: { is: seekerTextFilter(globalSearch) } },
    ];
    conditions.push({ OR: clauses });
  }
  if (seekerSearch) conditions.push({ seeker: { is: seekerSearch } });
  if (status === 'REVERSED') {
    conditions.push({ status: 'FAILED' }, { payout: { is: { status: 'FAILED' } } }, ...reversalEntries);
  } else if (status === 'FAILED') {
    conditions.push({ status: 'FAILED' });
  } else if (status === 'PROCESSING') {
    conditions.push({ OR: [{ status: 'PROCESSING' }, { status: 'SUCCESSFUL' }] });
  } else if (status) {
    conditions.push({ status });
  }

  return {
    ...(currency ? { currency } : {}),
    ...(provider ? { provider } : {}),
    ...((from || to) ? { requestedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(conditions.length ? { AND: conditions } : {}),
  };
};

const reversalSummaryWhere = (filters) => {
  const baseWhere = buildWhere({ ...filters, status: undefined });
  return {
    ...baseWhere,
    status: 'FAILED',
    payout: { is: { status: 'FAILED' } },
    AND: [
      ...(baseWhere.AND ?? []),
      ...reversalEntries,
    ],
  };
};

const reversalSummarySelect = {
  id: true,
  walletId: true,
  amount: true,
  currency: true,
  status: true,
  payout: { select: { id: true, amount: true, status: true } },
  ledgerEntries: {
    where: { entryType: { in: ['WITHDRAWAL_SUCCESSFUL', 'WITHDRAWAL_FAILED_REVERSAL'] } },
    select: { entryType: true, payoutId: true, walletId: true, currency: true, amount: true },
  },
};

const summarizeReversalCandidates = (withdrawals) => {
  const counts = new Map();
  for (const withdrawal of withdrawals) {
    if (!isReversed(withdrawal)) continue;
    counts.set(withdrawal.currency, (counts.get(withdrawal.currency) ?? 0) + 1);
  }
  return [...counts].map(([currency, count]) => ({ currency, _count: { _all: count } }));
};

const buildSummaries = (groups, reversalGroups, successfulWithdrawals, selectedStatus) => {
  const byCurrency = new Map();
  const getSummary = (currency) => {
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        totalWithdrawals: 0,
        pending: 0,
        processing: 0,
        successful: 0,
        failed: 0,
        reversed: 0,
        cancelled: 0,
        totalSuccessfullyPaidCents: 0n,
        pendingAmountCents: 0n,
        processingAmountCents: 0n,
      });
    }
    return byCurrency.get(currency);
  };
  const reversedByCurrency = new Map(reversalGroups.map((group) => [
    group.currency,
    { count: group._count._all },
  ]));
  const successfulByCurrency = new Map();
  for (const withdrawal of successfulWithdrawals) {
    if (!successfulByCurrency.has(withdrawal.currency)) {
      successfulByCurrency.set(withdrawal.currency, {
        count: 0,
        paidCents: 0n,
        inconsistentCount: 0,
        inconsistentAmountCents: 0n,
      });
    }
    const summary = successfulByCurrency.get(withdrawal.currency);
    if (isConfirmedSuccessful(withdrawal)) {
      summary.count += 1;
      summary.paidCents += amountToCents(withdrawal.payout.amount);
    } else {
      summary.inconsistentCount += 1;
      summary.inconsistentAmountCents += amountToCents(withdrawal.payoutAmount);
    }
  }

  for (const group of groups) {
    const summary = getSummary(group.currency);
    const count = group._count._all;
    const awaitingAmountCents = amountToCents(group._sum.payoutAmount);
    const status = selectedStatus === 'REVERSED' ? 'REVERSED' : group.status.toLowerCase();
    if (status === 'pending') {
      summary.pending += count;
      summary.pendingAmountCents += awaitingAmountCents;
    }
    if (status === 'processing') {
      summary.processing += count;
      summary.processingAmountCents += awaitingAmountCents;
    }
    if (status === 'successful') {
      summary.successful += count;
    }
    if (status === 'failed') summary.failed += count;
    if (status === 'reversed') summary.reversed += count;
    if (status === 'cancelled') summary.cancelled += count;
    summary.totalWithdrawals += count;
  }

  for (const [currency, successful] of successfulByCurrency) {
    const summary = getSummary(currency);
    if (selectedStatus === 'SUCCESSFUL') {
      summary.successful = successful.count;
      summary.totalSuccessfullyPaidCents = successful.paidCents;
      summary.totalWithdrawals = successful.count;
    } else if (selectedStatus === 'PROCESSING') {
      summary.successful = 0;
      summary.totalSuccessfullyPaidCents = 0n;
      summary.totalWithdrawals -= successful.count;
      summary.processing += successful.inconsistentCount;
      summary.processingAmountCents += successful.inconsistentAmountCents;
    } else {
      summary.successful = successful.count;
      summary.totalSuccessfullyPaidCents = successful.paidCents;
      summary.processing += successful.inconsistentCount;
      summary.processingAmountCents += successful.inconsistentAmountCents;
    }
  }

  if (!selectedStatus) {
    for (const [currency, reversal] of reversedByCurrency) {
      const summary = getSummary(currency);
      summary.failed = Math.max(0, summary.failed - reversal.count);
      summary.reversed += reversal.count;
    }
  } else if (selectedStatus === 'REVERSED') {
    for (const group of reversalGroups) {
      const summary = getSummary(group.currency);
      summary.reversed = group._count._all;
      summary.totalWithdrawals = group._count._all;
    }
  }

  for (const summary of byCurrency.values()) {
    summary.totalSuccessfullyPaid = centsToAmount(summary.totalSuccessfullyPaidCents);
    summary.totalAwaitingProcessing = centsToAmount(summary.pendingAmountCents + summary.processingAmountCents);
    delete summary.totalSuccessfullyPaidCents;
    delete summary.pendingAmountCents;
    delete summary.processingAmountCents;
  }
  return [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
};

const listSelect = {
  id: true,
  walletId: true,
  amount: true,
  payoutAmount: true,
  currency: true,
  status: true,
  provider: true,
  providerReference: true,
  requestedAt: true,
  updatedAt: true,
  seeker: { select: { id: true, firstName: true, lastName: true, email: true } },
  payout: {
    select: {
      id: true,
      amount: true,
      status: true,
      providerReference: true,
      attempts: {
        orderBy: [{ attemptNumber: 'desc' }],
        take: 1,
        select: { providerReference: true },
      },
    },
  },
  ledgerEntries: {
    where: { entryType: { in: ['WITHDRAWAL_SUCCESSFUL', 'WITHDRAWAL_FAILED_REVERSAL'] } },
    select: { entryType: true, payoutId: true, walletId: true, currency: true, amount: true },
  },
};

const mapWithdrawal = (withdrawal) => {
  const reversed = isReversed(withdrawal);
  const successful = isConfirmedSuccessful(withdrawal);
  return {
    id: withdrawal.id,
    seeker: {
      id: withdrawal.seeker.id,
      name: `${withdrawal.seeker.firstName} ${withdrawal.seeker.lastName}`.trim(),
      email: withdrawal.seeker.email,
    },
    amount: decimalToString(withdrawal.amount),
    currency: withdrawal.currency,
    provider: withdrawal.provider,
    status: reversed ? 'REVERSED' : withdrawal.status === 'SUCCESSFUL' && !successful ? 'PROCESSING' : withdrawal.status,
    requestedAt: withdrawal.requestedAt,
    updatedAt: withdrawal.updatedAt,
    providerReference: withdrawal.payout?.providerReference ?? withdrawal.providerReference,
    providerTransferCode: withdrawal.payout?.attempts?.[0]?.providerReference ?? null,
  };
};

const pageResult = (items, limit) => {
  const hasNextPage = items.length > limit;
  const page = hasNextPage ? items.slice(0, limit) : items;
  return {
    items: page.map(mapWithdrawal),
    nextCursor: hasNextPage ? page[page.length - 1].id : null,
  };
};

const listWithdrawalRecords = async (filters, where) => {
  const orderBy = [{ requestedAt: 'desc' }, { id: 'desc' }];
  if (!['FAILED', 'REVERSED', 'SUCCESSFUL', 'PROCESSING'].includes(filters.status)) {
    const records = await prisma.withdrawal.findMany({
      where,
      orderBy,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: listSelect,
    });
    return pageResult(records, filters.limit);
  }

  const matchingRecords = [];
  let cursor = filters.cursor;
  let exhausted = false;
  while (matchingRecords.length <= filters.limit && !exhausted) {
    const records = await prisma.withdrawal.findMany({
      where,
      orderBy,
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: listSelect,
    });
    if (!records.length) break;
    for (const record of records) {
      cursor = record.id;
      if (mapWithdrawal(record).status === filters.status) matchingRecords.push(record);
      if (matchingRecords.length > filters.limit) break;
    }
    exhausted = records.length < 100;
  }
  return pageResult(matchingRecords, filters.limit);
};

export const listAdminWithdrawals = async (filters) => {
  const where = buildWhere(filters);
  const [records, groups, reversalGroups, successfulWithdrawals] = await Promise.all([
    listWithdrawalRecords(filters, where),
    prisma.withdrawal.groupBy({
      by: ['currency', 'status'],
      where,
      _count: { _all: true },
      _sum: { amount: true, payoutAmount: true },
    }),
    filters.status && !['FAILED', 'REVERSED'].includes(filters.status)
      ? Promise.resolve([])
      : prisma.withdrawal.findMany({
        where: reversalSummaryWhere(filters),
        select: reversalSummarySelect,
      }),
    filters.status && !['SUCCESSFUL', 'PROCESSING'].includes(filters.status)
      ? Promise.resolve([])
      : prisma.withdrawal.findMany({
        where: {
          ...buildWhere({ ...filters, status: undefined }),
          status: 'SUCCESSFUL',
        },
        select: {
          ...reversalSummarySelect,
          payoutAmount: true,
        },
      }),
  ]);
  return {
    ...records,
    summaryByCurrency: buildSummaries(
      groups,
      summarizeReversalCandidates(reversalGroups),
      successfulWithdrawals,
      filters.status,
    ),
  };
};

const ledgerEventTitle = {
  WITHDRAWAL_RESERVED: 'Wallet balance reserved',
  WITHDRAWAL_SUCCESSFUL: 'Successful payout recorded',
  WITHDRAWAL_FAILED_REVERSAL: 'Wallet reversal recorded',
  WITHDRAWAL_FEE: 'Withdrawal fee recorded',
  WITHDRAWAL_FEE_REVERSAL: 'Withdrawal fee reversal recorded',
};

const auditEventTitle = {
  WITHDRAWAL_REQUESTED: 'Withdrawal request recorded',
  WITHDRAWAL_RESERVED: 'Wallet balance reserved',
  TRANSFER_STARTED: 'Provider transfer initiated',
  TRANSFER_SUCCESSFUL: 'Provider transfer marked successful',
  TRANSFER_FAILED: 'Provider transfer marked failed',
  VERIFIED: 'Provider transfer verified',
  RECONCILED: 'Provider reconciliation attempted',
};

const buildTimeline = ({ withdrawal, payout, attempts, ledgerEntries, auditLogs, webhookEvents }) => {
  const timeline = [{
    id: `withdrawal-requested-${withdrawal.id}`,
    type: 'withdrawal',
    title: 'Withdrawal requested',
    status: withdrawal.status,
    occurredAt: withdrawal.requestedAt,
  }];
  if (payout) {
    timeline.push({
      id: `payout-created-${payout.id}`,
      type: 'payout',
      title: 'Payout created',
      status: payout.status,
      occurredAt: payout.createdAt,
    });
  }
  for (const entry of ledgerEntries) {
    if (!ledgerEventTitle[entry.entryType]) continue;
    timeline.push({
      id: `ledger-${entry.id}`,
      type: 'ledger',
      title: ledgerEventTitle[entry.entryType],
      amount: decimalToString(entry.amount),
      currency: entry.currency,
      occurredAt: entry.createdAt,
    });
  }
  for (const attempt of attempts) {
    timeline.push({
      id: `attempt-created-${attempt.id}`,
      type: 'attempt',
      title: `Payout attempt ${attempt.attemptNumber} created`,
      status: attempt.status,
      occurredAt: attempt.createdAt,
    });
    if (attempt.processedAt) {
      timeline.push({
        id: `attempt-processed-${attempt.id}`,
        type: 'attempt',
        title: 'Provider attempt outcome recorded',
        status: attempt.status,
        detail: sanitizeProviderMessage(attempt.failureReason),
        occurredAt: attempt.processedAt,
      });
    }
  }
  for (const audit of auditLogs) {
    timeline.push({
      id: `audit-${audit.id}`,
      type: 'audit',
      title: auditEventTitle[audit.action] ?? `Financial audit: ${audit.action.toLowerCase().replaceAll('_', ' ')}`,
      status: audit.toStatus,
      detail: sanitizeProviderMessage(audit.reason),
      occurredAt: audit.createdAt,
    });
  }
  for (const event of webhookEvents) {
    timeline.push({
      id: `webhook-received-${event.id}`,
      type: 'webhook',
      title: 'Provider webhook received',
      status: event.processedAt ? 'PROCESSED' : 'PENDING',
      detail: event.eventType,
      occurredAt: event.createdAt,
    });
    if (event.processedAt) {
      timeline.push({
        id: `webhook-processed-${event.id}`,
        type: 'webhook',
        title: 'Provider webhook processed',
        detail: sanitizeProviderMessage(event.lastError),
        occurredAt: event.processedAt,
      });
    }
  }
  return timeline.sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt));
};

export const getAdminWithdrawal = async (id) => {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id },
    select: {
      id: true,
      walletId: true,
      seekerId: true,
      amount: true,
      withdrawalFeeAmount: true,
      payoutAmount: true,
      currency: true,
      status: true,
      provider: true,
      providerReference: true,
      payoutMethodSnapshot: true,
      payoutCountrySnapshot: true,
      bankNameSnapshot: true,
      accountNameSnapshot: true,
      accountNumberLast4Snapshot: true,
      requestedAt: true,
      processingAt: true,
      completedAt: true,
      failedAt: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
      seeker: { select: { id: true, firstName: true, lastName: true, email: true } },
      payout: {
        select: {
          id: true,
          amount: true,
          currency: true,
          provider: true,
          providerReference: true,
          status: true,
          requestedAt: true,
          processedAt: true,
          failedAt: true,
          failureReason: true,
          createdAt: true,
          updatedAt: true,
          attempts: {
            orderBy: [{ attemptNumber: 'asc' }],
            select: {
              id: true,
              attemptNumber: true,
              providerReference: true,
              status: true,
              failureReason: true,
              createdAt: true,
              updatedAt: true,
              processedAt: true,
            },
          },
        },
      },
      ledgerEntries: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, entryType: true, amount: true, currency: true, createdAt: true, payoutId: true, walletId: true },
      },
    },
  });
  if (!withdrawal) return null;

  const payout = withdrawal.payout;
  const ledgerEntries = withdrawal.ledgerEntries;
  const references = [...new Set([
    withdrawal.providerReference,
    payout?.providerReference,
    ...(payout?.attempts ?? []).map((attempt) => attempt.providerReference),
  ].filter(Boolean))];
  const providerIds = [...new Set([withdrawal.provider, payout?.provider].filter(Boolean))];
  const entityIds = [withdrawal.id, ...(payout ? [payout.id] : [])];
  const [auditLogs, webhookEvents] = await Promise.all([
    prisma.financialAuditLog.findMany({
      where: { entityType: { in: ['WITHDRAWAL', 'PAYOUT'] }, entityId: { in: entityIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, action: true, toStatus: true, reason: true, createdAt: true },
    }),
    references.length && providerIds.length
      ? prisma.providerWebhookEvent.findMany({
        where: { paymentReference: { in: references }, provider: { in: providerIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, provider: true, eventType: true, attempts: true, lastError: true, createdAt: true, processedAt: true },
      })
      : Promise.resolve([]),
  ]);
  const lastReconciliation = auditLogs.reduce(
    (latest, audit) => (audit.action === 'RECONCILED' ? audit.createdAt : latest),
    null,
  );
  const reversed = isReversed({ ...withdrawal, ledgerEntries });
  const successful = isConfirmedSuccessful({ ...withdrawal, ledgerEntries });
  const attempts = (payout?.attempts ?? []).map((attempt) => ({
    ...attempt,
    failureReason: sanitizeProviderMessage(attempt.failureReason),
  }));
  return {
    id: withdrawal.id,
    seeker: {
      id: withdrawal.seeker.id,
      name: `${withdrawal.seeker.firstName} ${withdrawal.seeker.lastName}`.trim(),
      email: withdrawal.seeker.email,
    },
    amount: decimalToString(withdrawal.amount),
    withdrawalFeeAmount: decimalToString(withdrawal.withdrawalFeeAmount),
    payoutAmount: decimalToString(withdrawal.payoutAmount),
    currency: withdrawal.currency,
    status: reversed ? 'REVERSED' : withdrawal.status === 'SUCCESSFUL' && !successful ? 'PROCESSING' : withdrawal.status,
    provider: withdrawal.provider,
    providerReference: payout?.providerReference ?? withdrawal.providerReference,
    requestedAt: withdrawal.requestedAt,
    processingAt: withdrawal.processingAt,
    completedAt: withdrawal.completedAt,
    failedAt: withdrawal.failedAt,
    updatedAt: withdrawal.updatedAt,
    failureReason: sanitizeProviderMessage(withdrawal.failureReason),
    bankDestination: {
      bankName: withdrawal.bankNameSnapshot,
      accountHolderName: withdrawal.accountNameSnapshot,
      maskedAccountNumber: withdrawal.accountNumberLast4Snapshot
        ? `•••• ${withdrawal.accountNumberLast4Snapshot}`
        : null,
      payoutMethod: withdrawal.payoutMethodSnapshot,
      country: withdrawal.payoutCountrySnapshot,
    },
    providerInfo: {
      transferReference: payout?.providerReference ?? withdrawal.providerReference,
      transferCode: [...(payout?.attempts ?? [])].reverse().find((attempt) => attempt.providerReference)?.providerReference ?? null,
      status: payout?.status ?? withdrawal.status,
      lastReconciliationAt: lastReconciliation,
      reconciliationTimestampRecorded: Boolean(lastReconciliation),
    },
    payout: payout ? {
      id: payout.id,
      amount: decimalToString(payout.amount),
      currency: payout.currency,
      provider: payout.provider,
      providerReference: payout.providerReference,
      status: payout.status,
      requestedAt: payout.requestedAt,
      processedAt: payout.processedAt,
      failedAt: payout.failedAt,
      createdAt: payout.createdAt,
      updatedAt: payout.updatedAt,
      failureReason: sanitizeProviderMessage(payout.failureReason),
      attempts,
    } : null,
    ledgerEntries: ledgerEntries.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      amount: decimalToString(entry.amount),
      currency: entry.currency,
      createdAt: entry.createdAt,
    })),
    auditEvents: auditLogs.map((audit) => ({
      id: audit.id,
      action: audit.action,
      status: audit.toStatus,
      reason: sanitizeProviderMessage(audit.reason),
      createdAt: audit.createdAt,
    })),
    webhookEvents: webhookEvents.map((event) => ({
      id: event.id,
      provider: event.provider,
      eventType: event.eventType,
      attempts: event.attempts,
      lastError: sanitizeProviderMessage(event.lastError),
      createdAt: event.createdAt,
      processedAt: event.processedAt,
    })),
    timeline: buildTimeline({ withdrawal, payout, attempts, ledgerEntries, auditLogs, webhookEvents }),
  };
};
