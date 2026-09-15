import { prisma } from '../config/database.js';

const normalizeEntitlementKey = (value) => String(value ?? '').trim().toUpperCase();

const currentValidityWhere = (now = new Date()) => ({
  status: 'ACTIVE',
  startDate: { not: null, lte: now },
  endDate: { not: null, gt: now },
});

const getPlanEntitlementKeys = (plan) => {
  if (!plan || !Array.isArray(plan.entitlements)) {
    return [];
  }

  return [...new Set(plan.entitlements
    .map(({ entitlement }) => normalizeEntitlementKey(entitlement?.key))
    .filter(Boolean))];
};

const planSelection = {
  id: true,
  key: true,
  displayName: true,
  description: true,
  price: true,
  currency: true,
  billingInterval: true,
  isActive: true,
  isPublic: true,
  benefits: true,
  entitlements: {
    select: {
      entitlement: {
        select: {
          id: true,
          key: true,
          displayName: true,
          description: true,
          isActive: true,
        },
      },
    },
  },
};

export const getActiveSubscriptionForUser = async (userId, client = prisma) => {
  if (!userId) {
    return null;
  }

  return client.subscription.findFirst({
    where: { userId, ...currentValidityWhere() },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      userId: true,
      planId: true,
      status: true,
      priceSnapshot: true,
      currencySnapshot: true,
      billingIntervalSnapshot: true,
      startDate: true,
      endDate: true,
      cancelledAt: true,
      cancellationReason: true,
      nextRenewalAt: true,
      createdAt: true,
      updatedAt: true,
      plan: { select: planSelection },
    },
  });
};

export const getCurrentSubscriptionState = async (userId, client = prisma) => {
  const activeSubscription = await getActiveSubscriptionForUser(userId, client);
  if (!activeSubscription) {
    return {
      subscription: null,
      plan: null,
      entitlements: [],
      hasActiveSubscription: false,
    };
  }

  const entitlements = getPlanEntitlementKeys(activeSubscription.plan);
  return {
    subscription: activeSubscription,
    plan: activeSubscription.plan ? {
      ...activeSubscription.plan,
      price: activeSubscription.plan.price ? activeSubscription.plan.price.toString() : null,
      benefits: Array.isArray(activeSubscription.plan.benefits) ? activeSubscription.plan.benefits : [],
      entitlements,
    } : null,
    entitlements,
    hasActiveSubscription: true,
  };
};

export const getCurrentSubscriptionEntitlements = async (userId, client = prisma) => {
  const state = await getCurrentSubscriptionState(userId, client);
  return state.entitlements;
};

export const hasEntitlement = async (userId, entitlementKey, client = prisma) => {
  const normalized = normalizeEntitlementKey(entitlementKey);
  if (!normalized) {
    return false;
  }

  const state = await getCurrentSubscriptionState(userId, client);
  if (!state.hasActiveSubscription) {
    return false;
  }

  return state.entitlements.includes(normalized);
};

export const listSeekerSubscriptions = async (userId, client = prisma) => {
  const subscriptions = await client.subscription.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      userId: true,
      status: true,
      planId: true,
      priceSnapshot: true,
      currencySnapshot: true,
      billingIntervalSnapshot: true,
      startDate: true,
      endDate: true,
      cancelledAt: true,
      cancellationReason: true,
      nextRenewalAt: true,
      createdAt: true,
      updatedAt: true,
      plan: { select: planSelection },
    },
  });

  const now = new Date();
  const activeSubscription = subscriptions.find((subscription) => (
    subscription.status === 'ACTIVE'
      && subscription.startDate
      && subscription.startDate <= now
      && subscription.endDate
      && subscription.endDate > now
  )) ?? null;
  const entitlements = activeSubscription ? getPlanEntitlementKeys(activeSubscription.plan) : [];

  return {
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      entitlements: getPlanEntitlementKeys(subscription.plan),
      plan: subscription.plan ? {
        ...subscription.plan,
        price: subscription.plan.price ? subscription.plan.price.toString() : null,
        benefits: Array.isArray(subscription.plan.benefits) ? subscription.plan.benefits : [],
      } : null,
    })),
    currentSubscription: activeSubscription ? {
      ...activeSubscription,
      entitlements,
      plan: activeSubscription.plan ? {
        ...activeSubscription.plan,
        price: activeSubscription.plan.price ? activeSubscription.plan.price.toString() : null,
        benefits: Array.isArray(activeSubscription.plan.benefits) ? activeSubscription.plan.benefits : [],
      } : null,
    } : null,
    activeSubscription: activeSubscription ? {
      ...activeSubscription,
      entitlements,
      plan: activeSubscription.plan ? {
        ...activeSubscription.plan,
        price: activeSubscription.plan.price ? activeSubscription.plan.price.toString() : null,
        benefits: Array.isArray(activeSubscription.plan.benefits) ? activeSubscription.plan.benefits : [],
      } : null,
    } : null,
    entitlements,
    currentPlan: activeSubscription?.plan ? {
      ...activeSubscription.plan,
      price: activeSubscription.plan.price ? activeSubscription.plan.price.toString() : null,
      benefits: Array.isArray(activeSubscription.plan.benefits) ? activeSubscription.plan.benefits : [],
      entitlements,
    } : null,
  };
};
