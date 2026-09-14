import { prisma } from '../config/database.js';

const paymentSelect = {
  id: true,
  providerReference: true,
  transactionId: true,
  amount: true,
  currency: true,
  status: true,
  paymentType: true,
  provider: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  subscription: { select: { id: true, plan: true, status: true } },
  escrow: {
    select: {
      id: true,
      freelanceContract: {
        select: {
          contract: {
            select: {
              id: true,
              job: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  },
};

const decimalToString = (value) => value?.toString() ?? '0.00';
const pageResult = (items, limit, mapItem) => {
  const hasNextPage = items.length > limit;
  const page = hasNextPage ? items.slice(0, limit) : items;
  return { items: page.map(mapItem), nextCursor: hasNextPage ? page[page.length - 1].id : null };
};

const mapPayment = (payment) => {
  const contract = payment.escrow?.freelanceContract?.contract;
  return {
    id: payment.id,
    providerReference: payment.providerReference,
    transactionId: payment.transactionId,
    payer: {
      id: payment.user.id,
      name: `${payment.user.firstName} ${payment.user.lastName}`.trim(),
      email: payment.user.email,
    },
    paymentType: payment.paymentType,
    provider: payment.provider,
    amount: decimalToString(payment.amount),
    currency: payment.currency,
    status: payment.status,
    verifiedAt: payment.verifiedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    context: {
      subscriptionId: payment.subscription?.id ?? null,
      subscriptionPlan: payment.subscription?.plan ?? null,
      escrowId: payment.escrow?.id ?? null,
      contractId: contract?.id ?? null,
      jobId: contract?.job?.id ?? null,
      jobTitle: contract?.job?.title ?? null,
    },
  };
};

export const listAdminPayments = async ({ limit, cursor, status, paymentType, provider, currency, from, to, search }) => {
  const where = {
    ...(status ? { status } : {}),
    ...(paymentType ? { paymentType } : {}),
    ...(provider ? { provider } : {}),
    ...(currency ? { currency } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(search ? {
      OR: [
        { providerReference: { contains: search, mode: 'insensitive' } },
        { transactionId: { contains: search, mode: 'insensitive' } },
        { user: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
      ],
    } : {}),
  };

  const payments = await prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: paymentSelect,
  });

  return pageResult(payments, limit, mapPayment);
};