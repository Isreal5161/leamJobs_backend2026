import { prisma } from '../config/database.js';
import { canonicalizeEntitlementKey } from './subscriptionFeatureCatalog.js';

const normalizeEntitlementKey = canonicalizeEntitlementKey;
const normalizePlanKey = (value) => String(value ?? '').trim().toUpperCase();

const currentValidityWhere = (now = new Date()) => ({
  status: 'ACTIVE',
  startDate: { not: null, lte: now },
  endDate: { not: null, gt: now },
});

const getPlanEntitlementKeys = (plan) => {
  if (!plan || !Array.isArray(plan.entitlements)) {
    return [];
  }

  return [...new Set(plan.entitlements.flatMap(({ entitlement }) => {
    const rawKey = String(entitlement?.key ?? '').trim().toUpperCase();
    const canonicalKey = normalizeEntitlementKey(rawKey);
    return [rawKey, canonicalKey].filter(Boolean);
  }))];
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
  aiAllowance: true,
  aiUnlimited: true,
  featureConfig: true,
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

export const BASIC_PLAN_KEY = 'BASIC';
export const AI_ALLOWANCE_BY_PLAN = {
  BASIC: 5,
  PROFESSIONAL: 20,
  PREMIUM: 50,
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

export const getActiveTrialForUser = async (userId, client = prisma) => {
  if (!userId || !client?.userSubscriptionTrial) {
    return null;
  }

  const now = new Date();
  return client.userSubscriptionTrial.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      startAt: { lte: now },
      endAt: { gt: now },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

const getPlanForKey = async (planKey, client = prisma) => {
  const normalized = normalizePlanKey(planKey);
  if (!normalized) {
    return null;
  }
  if (!client?.subscriptionPlan) {
    return null;
  }

  return client.subscriptionPlan.findUnique({
    where: { key: normalized },
    select: planSelection,
  });
};

export const resolveEffectiveEntitlements = async (userId, client = prisma) => {
  const activeSubscription = await getActiveSubscriptionForUser(userId, client);
  const activeTrial = await getActiveTrialForUser(userId, client);

  if (activeTrial) {
    const grantedPlanKey = normalizePlanKey(activeTrial.grantedPlanKey || activeTrial.planKey || 'PREMIUM');
    const effectivePlan = await getPlanForKey(grantedPlanKey, client);
    const entitlements = getPlanEntitlementKeys(effectivePlan);
    return {
      userId,
      subscription: activeSubscription,
      trial: activeTrial,
      planKey: grantedPlanKey,
      effectivePlan,
      aiAllowance: effectivePlan?.aiAllowance ?? getAiAllowanceForPlan(grantedPlanKey),
      aiUnlimited: Boolean(effectivePlan?.aiUnlimited),
      source: 'TRIAL',
      entitlements,
      hasActiveSubscription: Boolean(activeSubscription),
      hasActiveTrial: true,
    };
  }

  if (activeSubscription) {
    const entitlements = getPlanEntitlementKeys(activeSubscription.plan);
    return {
      userId,
      subscription: activeSubscription,
      trial: null,
      planKey: normalizePlanKey(activeSubscription.plan?.key || BASIC_PLAN_KEY),
      effectivePlan: activeSubscription.plan,
      aiAllowance: activeSubscription.plan?.aiAllowance ?? getAiAllowanceForPlan(activeSubscription.plan?.key),
      aiUnlimited: Boolean(activeSubscription.plan?.aiUnlimited),
      source: 'SUBSCRIPTION',
      entitlements,
      hasActiveSubscription: true,
      hasActiveTrial: false,
    };
  }

  const effectivePlan = await getPlanForKey(BASIC_PLAN_KEY, client);
  return {
    userId,
    subscription: null,
    trial: null,
    planKey: BASIC_PLAN_KEY,
    effectivePlan,
    aiAllowance: effectivePlan?.aiAllowance ?? AI_ALLOWANCE_BY_PLAN.BASIC,
    aiUnlimited: Boolean(effectivePlan?.aiUnlimited),
    source: 'FREE',
    entitlements: getPlanEntitlementKeys(effectivePlan),
    hasActiveSubscription: false,
    hasActiveTrial: false,
  };
};

export const getCurrentSubscriptionState = async (userId, client = prisma) => {
  const state = await resolveEffectiveEntitlements(userId, client);
  return {
    subscription: state.subscription,
    plan: state.subscription?.plan ? {
      ...state.subscription.plan,
      price: state.subscription.plan.price ? state.subscription.plan.price.toString() : null,
      benefits: Array.isArray(state.subscription.plan.benefits) ? state.subscription.plan.benefits : [],
      entitlements: state.entitlements,
    } : null,
    entitlements: state.entitlements,
    hasActiveSubscription: state.hasActiveSubscription,
    planKey: state.planKey,
    source: state.source,
  };
};

export const getCurrentSubscriptionEntitlements = async (userId, client = prisma) => {
  const state = await resolveEffectiveEntitlements(userId, client);
  return state.entitlements;
};

export const hasEntitlement = async (userId, entitlementKey, client = prisma, stateOverride = null) => {
  const normalized = normalizeEntitlementKey(entitlementKey);
  if (!normalized) {
    return false;
  }

  const state = stateOverride ?? await resolveEffectiveEntitlements(userId, client);
  return state.entitlements.includes(normalized);
};

export const getUserSubscription = async (userId, client = prisma) => resolveEffectiveEntitlements(userId, client);
export const checkActiveSubscription = async (userId, client = prisma) => {
  const state = await resolveEffectiveEntitlements(userId, client);
  return { active: Boolean(state.subscription), source: state.source, planKey: state.planKey };
};
export const checkActiveTrial = async (userId, client = prisma) => {
  const trial = await getActiveTrialForUser(userId, client);
  return { active: Boolean(trial), trial };
};

export const checkFeatureAccess = async (userId, entitlementKey, client = prisma) => {
  const normalized = normalizeEntitlementKey(entitlementKey);
  const state = await resolveEffectiveEntitlements(userId, client);
  return {
    allowed: Boolean(normalized && state.entitlements.includes(normalized)),
    planKey: state.planKey,
    source: state.source,
    entitlements: state.entitlements,
    entitlementKey: normalized,
  };
};

export const getAiAllowanceForPlan = (planKey) => {
  const normalized = normalizePlanKey(planKey);
  return AI_ALLOWANCE_BY_PLAN[normalized] ?? AI_ALLOWANCE_BY_PLAN.BASIC;
};

export const getAiUsagePeriod = (now = new Date()) => {
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextPeriodStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const periodEnd = new Date(nextPeriodStart.getTime() - 1);
  return { periodStart, periodEnd, nextPeriodStart };
};

export const getAiUsageState = async (userId, client = prisma, stateOverride = null) => {
  const state = stateOverride ?? await resolveEffectiveEntitlements(userId, client);
  const planKey = state.planKey || BASIC_PLAN_KEY;
  const limit = state.aiUnlimited ? Infinity : Number.isInteger(state.aiAllowance) ? state.aiAllowance : getAiAllowanceForPlan(planKey);
  let used = 0;

  if (client?.aiUsageRecord) {
    const { periodStart, nextPeriodStart } = getAiUsagePeriod();
    const usage = await client.aiUsageRecord.aggregate({
      where: { userId, periodStart: { gte: periodStart, lt: nextPeriodStart } },
      _sum: { amount: true },
    });
    used = Number(usage?._sum?.amount ?? 0);
  }

  const remaining = Math.max(0, limit - used);
  return {
    userId,
    planKey,
    source: state.source,
    limit,
    used,
    remaining,
    unlimited: state.aiUnlimited,
    allowed: remaining > 0,
  };
};

export const canUseAiFeature = async (userId, featureKey = 'AI_COVER_LETTER', client = prisma, stateOverride = null) => {
  const state = stateOverride ?? await getAiUsageState(userId, client);
  const feature = normalizeEntitlementKey(featureKey);
  const featureAllowed = !feature || feature === 'AI_COVER_LETTER' || feature === 'AI_CV_REVIEW' || feature === 'AI_CV_IMPROVEMENT' || feature === 'APPLICATION_INSIGHTS' || feature === 'AI_CAREER_ASSISTANT' || feature === 'AI_INTERVIEW_PREPARATION' || feature === 'SKILLS_GAP_ANALYSIS' || feature === 'AI_JOB_MATCHING';
  return {
    allowed: state.allowed && featureAllowed,
    planKey: state.planKey,
    source: state.source,
    limit: state.limit,
    used: state.used,
    remaining: state.remaining,
    featureKey: feature,
    unlimited: state.unlimited,
  };
};

const lockUserForAiUsage = async (transaction, userId) => {
  const rows = await transaction.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  if (!rows[0]) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }
};

const recordAiUsageInTransaction = async ({ userId, featureKey, amount, metadata }, transaction) => {
  await lockUserForAiUsage(transaction, userId);

  const state = await getAiUsageState(userId, transaction);
  if (!state.unlimited && state.remaining < amount) {
    const error = new Error('This plan has reached its AI allowance limit.');
    error.status = 403;
    throw error;
  }

  const now = new Date();
  const { periodStart, periodEnd } = getAiUsagePeriod(now);
  const record = await transaction.aiUsageRecord.create({
    data: {
      userId,
      featureKey: normalizeEntitlementKey(featureKey || 'AI_COVER_LETTER'),
      planKey: state.planKey,
      amount,
      periodStart,
      periodEnd,
      metadata,
    },
  });

  return { recorded: true, amount, record, remaining: state.unlimited ? null : state.remaining - amount };
};

export const releaseAiUsage = async ({ userId, usageRecordId, client = prisma } = {}) => {
  if (!userId || !usageRecordId || !client?.aiUsageRecord) return { released: false };
  const result = await client.aiUsageRecord.deleteMany({ where: { id: usageRecordId, userId } });
  return { released: result.count === 1 };
};

export const recordAiUsage = async ({ userId, featureKey, amount = 1, metadata = {}, client = prisma } = {}) => {
  if (!userId || !client?.aiUsageRecord) {
    return { recorded: false, amount: 0 };
  }

  const quantity = Math.max(1, Number(amount) || 1);
  const input = { userId, featureKey, amount: quantity, metadata };
  if (typeof client.$transaction === 'function') {
    return client.$transaction((transaction) => recordAiUsageInTransaction(input, transaction));
  }

  return recordAiUsageInTransaction(input, client);
};

export const startFreeTrial = async ({ userId, grantedPlanKey, durationDays, source = 'ADMIN', description = null, metadata = {} } = {}, client = prisma) => {
  if (!userId) {
    throw new Error('A userId is required to start a free trial.');
  }
  const settings = client?.subscriptionSettings ? await client.subscriptionSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', trialEnabled: true, trialDurationDays: 7, trialPlanKey: 'PREMIUM' } }) : null;
  if (settings && !settings.trialEnabled) {
    const error = new Error('Free trials are currently unavailable.');
    error.status = 403;
    throw error;
  }

  const effectiveGrantedPlanKey = normalizePlanKey(grantedPlanKey || settings?.trialPlanKey || 'PREMIUM');
  const effectiveDurationDays = Math.max(1, Number(durationDays || settings?.trialDurationDays || 7) || 7);

  if (!client?.userSubscriptionTrial) {
    return {
      id: 'trial-local',
      userId,
      grantedPlanKey: effectiveGrantedPlanKey,
      status: 'ACTIVE',
      startAt: new Date(),
      endAt: new Date(Date.now() + effectiveDurationDays * 24 * 60 * 60 * 1000),
      source,
      description,
      metadata,
    };
  }

  const existing = await getActiveTrialForUser(userId, client);
  if (existing) {
    const error = new Error('This user already has an active trial.');
    error.status = 409;
    throw error;
  }

  const now = new Date();
  const endAt = new Date(now.getTime() + effectiveDurationDays * 24 * 60 * 60 * 1000);
  return client.userSubscriptionTrial.create({
    data: {
      userId,
      grantedPlanKey: effectiveGrantedPlanKey,
      status: 'ACTIVE',
      durationDays: effectiveDurationDays,
      startAt: now,
      endAt,
      source,
      description,
      metadata,
    },
  });
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
  const activeTrial = await getActiveTrialForUser(userId, client);
  const entitlements = activeSubscription ? getPlanEntitlementKeys(activeSubscription.plan) : activeTrial ? await getEntitlementsForPlanKey(activeTrial.grantedPlanKey || 'PREMIUM', client) : [];

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
