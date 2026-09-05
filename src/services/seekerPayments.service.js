import { prisma } from '../config/database.js';

const EARNINGS_ENTRY_TYPE = 'WALLET_CREDIT';
const WITHDRAWAL_ENTRY_TYPE = 'WITHDRAWAL_SUCCESSFUL';

const decimalToString = (value) => (value === null || value === undefined ? '0.00' : value.toString());

const pageResult = (items, limit, mapItem) => {
  const hasNextPage = items.length > limit;
  const page = hasNextPage ? items.slice(0, limit) : items;
  return {
    items: page.map(mapItem),
    nextCursor: hasNextPage ? page[page.length - 1].id : null,
  };
};

const walletForSeeker = (seekerId) => prisma.wallet.findUnique({
  where: { userId: seekerId },
  select: { id: true, currency: true, availableBalance: true, pendingWithdrawalBalance: true },
});

const sumLedger = async (walletId, entryType) => {
  const result = await prisma.financialLedgerEntry.aggregate({
    where: { walletId, entryType },
    _sum: { amount: true },
  });
  return decimalToString(result._sum.amount);
};

export const getSeekerPaymentSummary = async (seekerId) => {
  const wallet = await walletForSeeker(seekerId);
  if (!wallet) {
    return {
      currency: null,
      availableBalance: '0.00',
      pendingWithdrawalBalance: '0.00',
      totalEarnings: '0.00',
      totalWithdrawn: '0.00',
    };
  }

  const [totalEarnings, totalWithdrawn] = await Promise.all([
    sumLedger(wallet.id, EARNINGS_ENTRY_TYPE),
    sumLedger(wallet.id, WITHDRAWAL_ENTRY_TYPE),
  ]);

  return {
    currency: wallet.currency,
    availableBalance: decimalToString(wallet.availableBalance),
    pendingWithdrawalBalance: decimalToString(wallet.pendingWithdrawalBalance),
    totalEarnings,
    totalWithdrawn,
  };
};

const paymentLedgerSelect = {
  id: true,
  amount: true,
  currency: true,
  description: true,
  createdAt: true,
  balanceAfter: true,
  contract: {
    select: {
      job: {
        select: {
          title: true,
          employer: { select: { employerProfile: { select: { companyName: true } } } },
        },
      },
    },
  },
  escrow: { select: { platformFeeAmount: true } },
};

const mapPaymentLedger = (entry) => ({
  id: entry.id,
  jobTitle: entry.contract?.job?.title ?? null,
  employerName: entry.contract?.job?.employer?.employerProfile?.companyName ?? null,
  amount: decimalToString(entry.amount),
  currency: entry.currency,
  platformFee: entry.escrow ? decimalToString(entry.escrow.platformFeeAmount) : null,
  netAmount: decimalToString(entry.amount),
  status: 'CREDITED',
  date: entry.createdAt,
});

export const getSeekerPayments = async (seekerId, { limit, cursor }) => {
  const wallet = await walletForSeeker(seekerId);
  if (!wallet) return { items: [], nextCursor: null };

  const entries = await prisma.financialLedgerEntry.findMany({
    where: { walletId: wallet.id, entryType: EARNINGS_ENTRY_TYPE },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: paymentLedgerSelect,
  });

  return pageResult(entries, limit, mapPaymentLedger);
};

const transactionSelect = {
  id: true,
  entryType: true,
  amount: true,
  currency: true,
  description: true,
  createdAt: true,
  balanceAfter: true,
};

const mapTransaction = (entry) => ({
  id: entry.id,
  type: entry.entryType,
  amount: decimalToString(entry.amount),
  currency: entry.currency,
  description: entry.description,
  createdAt: entry.createdAt,
  balanceAfter: entry.balanceAfter === null ? null : decimalToString(entry.balanceAfter),
});

export const getSeekerTransactions = async (seekerId, { limit, cursor }) => {
  const wallet = await walletForSeeker(seekerId);
  if (!wallet) return { items: [], nextCursor: null };

  const entries = await prisma.financialLedgerEntry.findMany({
    where: { walletId: wallet.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: transactionSelect,
  });

  return pageResult(entries, limit, mapTransaction);
};

const withdrawalSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  requestedAt: true,
  processingAt: true,
  completedAt: true,
  failedAt: true,
  failureReason: true,
  payoutAccount: { select: { accountNumberLast4: true } },
};

const mapWithdrawal = (withdrawal) => ({
  id: withdrawal.id,
  amount: decimalToString(withdrawal.amount),
  currency: withdrawal.currency,
  status: withdrawal.status,
  requestedAt: withdrawal.requestedAt,
  processingAt: withdrawal.processingAt,
  completedAt: withdrawal.completedAt,
  failedAt: withdrawal.failedAt,
  failureReason: withdrawal.failureReason,
  paymentMethod: withdrawal.payoutAccount ? {
    type: 'bank',
    last4: withdrawal.payoutAccount.accountNumberLast4,
  } : null,
});

export const getSeekerWithdrawals = async (seekerId, { limit, cursor }) => {
  const withdrawals = await prisma.withdrawal.findMany({
    where: { seekerId },
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: withdrawalSelect,
  });

  return pageResult(withdrawals, limit, mapWithdrawal);
};
