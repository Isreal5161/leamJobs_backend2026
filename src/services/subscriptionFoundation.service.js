import { prisma } from '../config/database.js';
import { subscriptionEntitlements } from './subscriptionFeatureCatalog.js';

export { subscriptionEntitlements } from './subscriptionFeatureCatalog.js';

export const subscriptionPlanFeatureDefaults = {
  BASIC: { savedJobsLimit: 20, jobAlertsLimit: 1, applicationLimit: 20, profileStrengthLevel: 'BASIC' },
  PROFESSIONAL: { savedJobsLimit: 100, jobAlertsLimit: 5, applicationLimit: 100, profileStrengthLevel: 'BASIC' },
  PREMIUM: { savedJobsLimit: null, jobAlertsLimit: null, applicationLimit: null, profileStrengthLevel: 'ADVANCED' },
};

export const subscriptionPlans = [
  {
    key: 'BASIC',
    displayName: 'Basic',
    description: 'Free access with limited AI usage and core job features.',
    price: null,
    currency: null,
    billingInterval: 'MONTHLY',
    aiAllowance: 5,
    aiUnlimited: false,
    featureConfig: { free: true, ...subscriptionPlanFeatureDefaults.BASIC },
    benefits: ['Browse jobs', 'Search & filters', 'Apply for jobs', 'Application tracking'],
    entitlementKeys: ['BROWSE_JOBS', 'SEARCH_FILTERS', 'APPLY_FOR_JOBS', 'SAVED_JOBS', 'JOB_ALERTS', 'BASIC_PROFILE', 'CV_UPLOAD', 'APPLICATION_TRACKING', 'PROFILE_STRENGTH'],
  },
  {
    key: 'PROFESSIONAL',
    displayName: 'Professional',
    description: 'Career visibility tools for active job seekers.',
    price: null,
    currency: null,
    billingInterval: 'MONTHLY',
    aiAllowance: 20,
    aiUnlimited: false,
    featureConfig: { tier: 'professional', ...subscriptionPlanFeatureDefaults.PROFESSIONAL },
    benefits: ['Advanced job filters', 'Career matching', 'AI CV review', 'AI cover letter', 'Application insights'],
    entitlementKeys: ['BROWSE_JOBS', 'SEARCH_FILTERS', 'APPLY_FOR_JOBS', 'SAVED_JOBS', 'JOB_ALERTS', 'BASIC_PROFILE', 'CV_UPLOAD', 'APPLICATION_TRACKING', 'PROFILE_STRENGTH', 'AI_CV_REVIEW', 'AI_CV_IMPROVEMENT', 'AI_COVER_LETTER', 'AI_JOB_MATCHING', 'APPLICATION_INSIGHTS', 'CAREER_RECOMMENDATIONS', 'PRIORITY_RECOMMENDATIONS', 'SALARY_CAREER_INSIGHTS'],
  },
  {
    key: 'PREMIUM',
    displayName: 'Premium',
    description: 'The strongest career visibility and advanced AI support.',
    price: null,
    currency: null,
    billingInterval: 'MONTHLY',
    aiAllowance: 50,
    aiUnlimited: false,
    featureConfig: { tier: 'premium', ...subscriptionPlanFeatureDefaults.PREMIUM },
    benefits: ['Priority recommendations', 'AI career assistant', 'Interview prep', 'Skills gap analysis', 'Premium matching'],
    entitlementKeys: ['BROWSE_JOBS', 'SEARCH_FILTERS', 'APPLY_FOR_JOBS', 'SAVED_JOBS', 'JOB_ALERTS', 'BASIC_PROFILE', 'CV_UPLOAD', 'APPLICATION_TRACKING', 'PROFILE_STRENGTH', 'AI_CV_REVIEW', 'AI_CV_IMPROVEMENT', 'AI_COVER_LETTER', 'AI_JOB_MATCHING', 'AI_INTERVIEW_PREPARATION', 'AI_CAREER_ASSISTANT', 'SKILLS_GAP_ANALYSIS', 'APPLICATION_INSIGHTS', 'CAREER_RECOMMENDATIONS', 'PRIORITY_RECOMMENDATIONS', 'SALARY_CAREER_INSIGHTS', 'PROFILE_VISIBILITY_BOOST', 'PREMIUM_SUPPORT'],
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
        aiAllowance: plan.aiAllowance,
        aiUnlimited: plan.aiUnlimited,
        featureConfig: plan.featureConfig,
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
        aiAllowance: plan.aiAllowance,
        aiUnlimited: plan.aiUnlimited,
        featureConfig: plan.featureConfig,
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