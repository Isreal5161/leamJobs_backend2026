import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  getEffectiveActiveWhere,
  getEffectiveExpiredWhere,
  getEffectiveSubscriptionStatus,
} from './subscriptionLifecycle.service.js';
import { canonicalizeEntitlementKey, subscriptionEntitlementKeys } from './subscriptionFeatureCatalog.js';

const planInclude = {
  entitlements: { select: { entitlement: { select: { key: true, displayName: true, description: true, isActive: true } } } },
};

const decimalToString = (value) => value === null || value === undefined ? null : value.toString();
const mapEntitlement = (entitlement) => ({
  key: entitlement.key,
  displayName: entitlement.displayName,
  description: entitlement.description,
  isActive: entitlement.isActive,
});
const mapPlan = (plan, availableEntitlements = []) => ({
  id: plan.id,
  key: plan.key,
  name: plan.displayName,
  description: plan.description,
  price: decimalToString(plan.price),
  currency: plan.currency,
  billingInterval: plan.billingInterval,
  active: plan.isActive,
  public: plan.isPublic,
  displayOrder: plan.displayOrder,
  benefits: Array.isArray(plan.benefits) ? plan.benefits : [],
  aiAllowance: plan.aiAllowance ?? null,
  featureConfig: plan.featureConfig ?? {},
  entitlements: (plan.entitlements ?? []).map(({ entitlement }) => ({ ...mapEntitlement(entitlement), key: canonicalizeEntitlementKey(entitlement.key) })),
  aiUnlimited: Boolean(plan.aiUnlimited),
  availableEntitlements: availableEntitlements.map(mapEntitlement),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

const assertEntitlements = async (entitlementKeys, client) => {
  const requestedKeys = [...new Set(entitlementKeys ?? [])];
  const keys = [...new Set(requestedKeys.map(canonicalizeEntitlementKey))];
  const lookupKeys = [...new Set([...requestedKeys, ...keys])];
  const rows = lookupKeys.length ? await client.entitlement.findMany({ where: { key: { in: lookupKeys }, isActive: true }, select: { id: true, key: true } }) : [];
  const found = new Set(rows.map((row) => canonicalizeEntitlementKey(row.key)));
  const missing = keys.filter((key) => !found.has(key));
  if (missing.length) {
    const error = new Error(`Unknown or inactive entitlement keys: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
  return rows;
};

const planData = (payload) => ({
  ...(payload.key !== undefined ? { key: payload.key } : {}),
  ...(payload.displayName !== undefined ? { displayName: payload.displayName } : {}),
  ...(payload.description !== undefined ? { description: payload.description } : {}),
  ...(payload.price !== undefined ? { price: payload.price === null ? null : new Prisma.Decimal(payload.price) } : {}),
  ...(payload.currency !== undefined ? { currency: payload.currency } : {}),
  ...(payload.billingInterval !== undefined ? { billingInterval: payload.billingInterval } : {}),
  ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
  ...(payload.isPublic !== undefined ? { isPublic: payload.isPublic } : {}),
  ...(payload.displayOrder !== undefined ? { displayOrder: payload.displayOrder } : {}),
  ...(payload.benefits !== undefined ? { benefits: payload.benefits } : {}),
  ...(payload.aiAllowance !== undefined ? { aiAllowance: payload.aiAllowance } : {}),
  ...(payload.aiUnlimited !== undefined ? { aiUnlimited: payload.aiUnlimited } : {}),
  ...(payload.featureConfig !== undefined ? { featureConfig: payload.featureConfig } : {}),
});

export const listAdminSubscriptionPlans = async () => {
  const [plans, availableEntitlements] = await Promise.all([
    prisma.subscriptionPlan.findMany({ orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }], include: planInclude }),
    prisma.entitlement.findMany({ where: { key: { in: [...subscriptionEntitlementKeys] }, isActive: true }, orderBy: { key: 'asc' } }),
  ]);
  return { plans: plans.map((plan) => mapPlan(plan, availableEntitlements)), availableEntitlements: availableEntitlements.map(mapEntitlement) };
};

const getAvailableEntitlements = async () => prisma.entitlement.findMany({ where: { key: { in: [...subscriptionEntitlementKeys] }, isActive: true }, orderBy: { key: 'asc' } });

export const createAdminSubscriptionPlan = async (payload) => {
  try {
    const plan = await prisma.$transaction(async (transaction) => {
      const entitlements = await assertEntitlements(payload.entitlementKeys, transaction);
      const created = await transaction.subscriptionPlan.create({ data: { ...planData(payload), entitlements: { create: entitlements.map(({ id }) => ({ entitlementId: id })) } }, include: planInclude });
      return created;
    });
    return mapPlan(plan, await getAvailableEntitlements());
  } catch (error) {
    if (error?.code === 'P2002') { error.status = 409; error.message = 'A subscription plan with this key already exists'; }
    throw error;
  }
};

export const updateAdminSubscriptionPlan = async (planId, payload) => {
  try {
    const plan = await prisma.$transaction(async (transaction) => {
      let entitlements;
      if (payload.entitlementKeys !== undefined) entitlements = await assertEntitlements(payload.entitlementKeys, transaction);
      const updated = await transaction.subscriptionPlan.update({ where: { id: planId }, data: { ...planData(payload), ...(entitlements ? { entitlements: { deleteMany: {}, create: entitlements.map(({ id }) => ({ entitlementId: id })) } } : {}) }, include: planInclude });
      return updated;
    });
    return mapPlan(plan, await getAvailableEntitlements());
  } catch (error) {
    if (error?.code === 'P2025') { error.status = 404; error.message = 'Subscription plan not found'; }
    if (error?.code === 'P2002') { error.status = 409; error.message = 'A subscription plan with this key already exists'; }
    throw error;
  }
};

const defaultTrialSettings = {
  id: 'default',
  trialEnabled: true,
  trialDurationDays: 7,
  trialPlanKey: 'PREMIUM',
};

const mapTrialSettings = (settings) => ({
  id: settings.id,
  trialEnabled: settings.trialEnabled,
  trialDurationDays: settings.trialDurationDays,
  trialPlanKey: settings.trialPlanKey,
  updatedAt: settings.updatedAt,
});

export const getAdminSubscriptionTrialSettings = async () => {
  if (!prisma.subscriptionSettings) return defaultTrialSettings;
  const settings = await prisma.subscriptionSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: defaultTrialSettings,
  });
  return mapTrialSettings(settings);
};

export const updateAdminSubscriptionTrialSettings = async (payload) => {
  if (!prisma.subscriptionSettings) return { ...defaultTrialSettings, ...payload };
  const plan = await prisma.subscriptionPlan.findUnique({ where: { key: payload.trialPlanKey }, select: { key: true, isActive: true } });
  if (!plan || !plan.isActive) {
    const error = new Error('The selected trial plan is not active.');
    error.status = 400;
    throw error;
  }
  const settings = await prisma.subscriptionSettings.upsert({
    where: { id: 'default' },
    update: payload,
    create: { ...defaultTrialSettings, ...payload },
  });
  return mapTrialSettings(settings);
};

const paymentSelect = {
  id: true, amount: true, currency: true, status: true, provider: true, providerReference: true, transactionId: true, verifiedAt: true, createdAt: true,
};
const mapPayment = (payment) => ({ ...payment, amount: decimalToString(payment.amount) });
const mapSubscription = (subscription) => ({
  id: subscription.id,
  userId: subscription.user.id,
  seeker: { id: subscription.user.id, name: `${subscription.user.firstName} ${subscription.user.lastName}`.trim(), email: subscription.user.email },
  plan: { id: subscription.plan.id, key: subscription.plan.key, name: subscription.plan.displayName },
  status: getEffectiveSubscriptionStatus(subscription),
  startDate: subscription.startDate,
  endDate: subscription.endDate,
  priceSnapshot: decimalToString(subscription.priceSnapshot),
  currencySnapshot: subscription.currencySnapshot,
  billingInterval: subscription.billingIntervalSnapshot,
  cancelledAt: subscription.cancelledAt,
  cancellationReason: subscription.cancellationReason,
  nextRenewalAt: subscription.nextRenewalAt,
  latestPayment: subscription.payments?.[0] ? mapPayment(subscription.payments[0]) : null,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
});

const subscriptionSelect = {
  id: true, status: true, startDate: true, endDate: true, priceSnapshot: true, currencySnapshot: true, billingIntervalSnapshot: true, cancelledAt: true, cancellationReason: true, nextRenewalAt: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  plan: { select: { id: true, key: true, displayName: true } },
  payments: { where: { paymentType: 'SUBSCRIPTION' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: paymentSelect },
};

export const getAdminSubscriptionSummary = async () => {
  const now = new Date();
  const activeWhere = getEffectiveActiveWhere(now);
  const expiredWhere = getEffectiveExpiredWhere(now);
  const [total, active, pending, expired, cancelled, failed, byPlan, successful, failedPayments, revenue] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: activeWhere }),
    prisma.subscription.count({ where: { status: 'PENDING' } }),
    prisma.subscription.count({ where: expiredWhere }),
    prisma.subscription.count({ where: { status: 'CANCELLED' } }),
    prisma.subscription.count({ where: { status: 'FAILED' } }),
    prisma.subscription.groupBy({ by: ['planId', 'status'], _count: { _all: true }, where: activeWhere }),
    prisma.payment.count({ where: { paymentType: 'SUBSCRIPTION', status: 'SUCCESSFUL' } }),
    prisma.payment.count({ where: { paymentType: 'SUBSCRIPTION', status: 'FAILED' } }),
    prisma.payment.groupBy({ by: ['currency'], _sum: { amount: true }, where: { paymentType: 'SUBSCRIPTION', status: 'SUCCESSFUL' } }),
  ]);
  const planIds = [...new Set(byPlan.map((row) => row.planId))];
  const plans = planIds.length ? await prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, key: true } }) : [];
  return {
    subscriptionCounts: { total, active, pending, expired, cancelled, failed },
    plans: plans.map((plan) => ({ planKey: plan.key, active: byPlan.find((row) => row.planId === plan.id)?._count._all ?? 0 })),
    payments: { successful, failed: failedPayments },
    revenue: revenue.map((row) => ({ currency: row.currency, amount: row._sum.amount?.toString() ?? '0' })),
  };
};

export const listAdminSubscriptions = async ({ limit, cursor, status, plan, currency, from, to, search }) => {
  const now = new Date();
  const lifecycleWhere = status === 'ACTIVE'
    ? getEffectiveActiveWhere(now)
    : status === 'EXPIRED'
      ? getEffectiveExpiredWhere(now)
      : status
        ? { status }
        : {};
  const where = {
    ...lifecycleWhere,
    ...(plan ? { plan: { key: plan } } : {}),
    ...(currency ? { currencySnapshot: currency } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(search ? { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } } : {}),
  };
  const rows = await prisma.subscription.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: subscriptionSelect });
  const hasNextPage = rows.length > limit;
  const page = hasNextPage ? rows.slice(0, limit) : rows;
  return { items: page.map(mapSubscription), nextCursor: hasNextPage ? page[page.length - 1].id : null };
};

export const getAdminSubscription = async (id) => {
  const subscription = await prisma.subscription.findUnique({ where: { id }, select: { ...subscriptionSelect, payments: { where: { paymentType: 'SUBSCRIPTION' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: paymentSelect }, events: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { id: true, eventType: true, occurredAt: true, providerReference: true } } } });
  if (!subscription) { const error = new Error('Subscription not found'); error.status = 404; throw error; }
  return { ...mapSubscription({ ...subscription, payments: subscription.payments.slice(0, 1) }), payments: subscription.payments.map(mapPayment), events: subscription.events };
};
