import { prisma } from '../config/database.js';

export const subscriptionEntitlements = [
  { key: 'RECOMMENDATION_BOOST', displayName: 'Recommendation boost', description: 'Allows a future server-side recommendation boost.' },
  { key: 'PROFILE_VISIBILITY_BOOST', displayName: 'Profile visibility boost', description: 'Allows a future profile visibility enhancement.' },
  { key: 'PROFILE_ANALYTICS', displayName: 'Profile analytics', description: 'Allows future profile analytics access.' },
  { key: 'FEATURED_CANDIDATE', displayName: 'Featured candidate', description: 'Allows future featured candidate placement.' },
  { key: 'ADVANCED_CV', displayName: 'Advanced CV', description: 'Allows future advanced CV capabilities.' },
  { key: 'AI_PROFILE_ASSISTANT', displayName: 'AI profile assistant', description: 'Reserved for a future AI profile assistant.' },
  { key: 'AI_CV_OPTIMIZER', displayName: 'AI CV optimizer', description: 'Reserved for a future AI CV optimizer.' },
  { key: 'AI_APPLICATION_ASSISTANCE', displayName: 'AI application assistance', description: 'Reserved for future AI application assistance.' },
];

export const subscriptionPlans = [
  {
    key: 'PROFESSIONAL',
    displayName: 'Professional',
    description: 'Career visibility tools for active job seekers.',
    price: null,
    currency: null,
    billingInterval: 'MONTHLY',
    benefits: ['Recommendation boost', 'Profile visibility boost', 'Professional badge', 'Profile analytics', 'Additional CV capabilities'],
    entitlementKeys: ['RECOMMENDATION_BOOST', 'PROFILE_VISIBILITY_BOOST', 'PROFILE_ANALYTICS', 'ADVANCED_CV'],
  },
  {
    key: 'PREMIUM',
    displayName: 'Premium',
    description: 'The strongest career visibility and future advanced capabilities.',
    price: null,
    currency: null,
    billingInterval: 'MONTHLY',
    benefits: ['Stronger recommendation boost', 'Stronger profile visibility', 'Featured candidate eligibility', 'Advanced profile analytics', 'Advanced CV capabilities', 'Future AI capabilities'],
    entitlementKeys: ['RECOMMENDATION_BOOST', 'PROFILE_VISIBILITY_BOOST', 'PROFILE_ANALYTICS', 'FEATURED_CANDIDATE', 'ADVANCED_CV', 'AI_PROFILE_ASSISTANT', 'AI_CV_OPTIMIZER', 'AI_APPLICATION_ASSISTANCE'],
  },
];

export const ensureDefaultSubscriptionFoundation = async (client = prisma) => {
  const entitlements = {};
  for (const entitlement of subscriptionEntitlements) {
    entitlements[entitlement.key] = await client.entitlement.upsert({
      where: { key: entitlement.key },
      update: { displayName: entitlement.displayName, description: entitlement.description, isActive: true },
      create: entitlement,
    });
  }

  const plans = {};
  for (const [displayOrder, plan] of subscriptionPlans.entries()) {
    const createdPlan = await client.subscriptionPlan.upsert({
      where: { key: plan.key },
      update: {
        displayName: plan.displayName,
        description: plan.description,
        billingInterval: plan.billingInterval,
        benefits: plan.benefits,
        isActive: true,
        isPublic: true,
        displayOrder,
      },
      create: {
        key: plan.key,
        displayName: plan.displayName,
        description: plan.description,
        price: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        benefits: plan.benefits,
        isActive: true,
        isPublic: true,
        displayOrder,
      },
    });
    plans[plan.key] = createdPlan;

    for (const entitlementKey of plan.entitlementKeys) {
      await client.planEntitlement.upsert({
        where: { planId_entitlementId: { planId: createdPlan.id, entitlementId: entitlements[entitlementKey].id } },
        update: {},
        create: { planId: createdPlan.id, entitlementId: entitlements[entitlementKey].id },
      });
    }
  }

  return { plans, entitlements };
};

export const recordSubscriptionEvent = async ({ subscriptionId, eventType, providerReference, metadata }, client = prisma) => client.subscriptionEvent.create({
  data: { subscriptionId, eventType, providerReference, metadata },
});