import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
const testDatabaseUrl = process.env.EMPLOYER_VISIBILITY_TEST_DATABASE_URL || process.env.PHASE4_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
const databaseConfigured = Boolean(testDatabaseUrl);

const { prisma } = await import('../src/config/database.js');
const { listEmployerCandidates } = await import('../src/services/employerCandidates.service.js');

const describePostgres = databaseConfigured ? describe : describe.skip;

describePostgres('Employer candidate visibility against PostgreSQL', () => {
  const createdUserIds = [];
  const createdPlanIds = [];
  let createdEntitlementId = null;
  let createdLegacyAliasEntitlementId = null;
  let createdProfessionalVisibilityEntitlementId = null;
  let restoreLegacyAliasEntitlement = false;
  let restoreProfessionalVisibilityEntitlement = false;
  let connected = false;
  let candidates;
  let plans;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;

    let boostEntitlement = await prisma.entitlement.findUnique({ where: { key: 'PROFILE_VISIBILITY_BOOST' } });
    if (!boostEntitlement) {
      boostEntitlement = await prisma.entitlement.create({
        data: {
          key: 'PROFILE_VISIBILITY_BOOST',
          displayName: 'Profile visibility boost',
          description: 'Integration-test fixture entitlement.',
          isActive: true,
        },
      });
      createdEntitlementId = boostEntitlement.id;
    }
    if (!boostEntitlement.isActive) throw new Error('PROFILE_VISIBILITY_BOOST must be active in the test database.');
    let legacyAliasEntitlement = await prisma.entitlement.findUnique({ where: { key: 'FEATURED_CANDIDATE' } });
    if (!legacyAliasEntitlement) {
      legacyAliasEntitlement = await prisma.entitlement.create({
        data: {
          key: 'FEATURED_CANDIDATE',
          displayName: 'Featured candidate (legacy alias)',
          description: 'Integration-test legacy alias fixture.',
          isActive: true,
        },
      });
      createdLegacyAliasEntitlementId = legacyAliasEntitlement.id;
    } else if (!legacyAliasEntitlement.isActive) {
      await prisma.entitlement.update({ where: { id: legacyAliasEntitlement.id }, data: { isActive: true } });
      restoreLegacyAliasEntitlement = true;
    }
    let professionalVisibilityEntitlement = await prisma.entitlement.findUnique({ where: { key: 'PROFESSIONAL_CANDIDATE_VISIBILITY' } });
    if (!professionalVisibilityEntitlement) {
      professionalVisibilityEntitlement = await prisma.entitlement.create({
        data: {
          key: 'PROFESSIONAL_CANDIDATE_VISIBILITY',
          displayName: 'Professional candidate visibility',
          description: 'Integration-test Professional visibility fixture.',
          isActive: true,
        },
      });
      createdProfessionalVisibilityEntitlementId = professionalVisibilityEntitlement.id;
    } else if (!professionalVisibilityEntitlement.isActive) {
      await prisma.entitlement.update({ where: { id: professionalVisibilityEntitlement.id }, data: { isActive: true } });
      restoreProfessionalVisibilityEntitlement = true;
    }

    const suffix = randomUUID();
    const professionalPlan = await prisma.subscriptionPlan.create({
      data: { key: `VISIBILITY_TEST_PRO_${suffix}`, displayName: 'Visibility test Professional' },
    });
    const premiumPlan = await prisma.subscriptionPlan.create({
      data: { key: `VISIBILITY_TEST_PREMIUM_${suffix}`, displayName: 'Visibility test Premium' },
    });
    const basicPlan = await prisma.subscriptionPlan.create({
      data: { key: `VISIBILITY_TEST_BASIC_${suffix}`, displayName: 'Visibility test Basic' },
    });
    const legacyAliasPlan = await prisma.subscriptionPlan.create({
      data: { key: `VISIBILITY_TEST_ALIAS_${suffix}`, displayName: 'Visibility test legacy alias' },
    });
    createdPlanIds.push(professionalPlan.id, premiumPlan.id, basicPlan.id, legacyAliasPlan.id);
    plans = { professional: professionalPlan, premium: premiumPlan, basic: basicPlan };
    await prisma.planEntitlement.create({ data: { planId: professionalPlan.id, entitlementId: professionalVisibilityEntitlement.id } });
    await prisma.planEntitlement.create({ data: { planId: premiumPlan.id, entitlementId: boostEntitlement.id } });
    await prisma.planEntitlement.create({ data: { planId: legacyAliasPlan.id, entitlementId: legacyAliasEntitlement.id } });

    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const expired = new Date(now.getTime() - 1000);
    const createCandidate = async ({ firstName, location, skills }) => {
      const id = randomUUID();
      createdUserIds.push(id);
      await prisma.user.create({
        data: {
          id,
          email: `visibility-${id}@example.test`,
          passwordHash: 'test-password-hash',
          firstName,
          lastName: 'Candidate',
          role: 'SEEKER',
          isActive: true,
          seekerProfile: { create: { professionalTitle: `${firstName} role`, location, skills } },
        },
      });
      return id;
    };

    const [basicAlpha, professional, premiumSubscriber, basicBeta, premiumTrial, legacyAlias, expiredPremium, cancelledPremium] = await Promise.all([
      createCandidate({ firstName: 'Basic Alpha', location: 'Lagos', skills: ['React'] }),
      createCandidate({ firstName: 'Professional', location: 'Abuja', skills: ['Python'] }),
      createCandidate({ firstName: 'Premium Subscriber', location: 'Lagos', skills: ['React'] }),
      createCandidate({ firstName: 'Basic Beta', location: 'Lagos', skills: ['SQL'] }),
      createCandidate({ firstName: 'Premium Trial', location: 'Lagos', skills: ['Java'] }),
      createCandidate({ firstName: 'Legacy Alias Boost', location: 'Lagos', skills: ['React'] }),
      createCandidate({ firstName: 'Expired Premium', location: 'Abuja', skills: ['SQL'] }),
      createCandidate({ firstName: 'Cancelled Premium', location: 'Abuja', skills: ['Python'] }),
    ]);
    candidates = { basicAlpha, professional, premiumSubscriber, basicBeta, premiumTrial, legacyAlias, expiredPremium, cancelledPremium };

    await prisma.subscription.createMany({
      data: [
        { userId: professional, planId: professionalPlan.id, status: 'ACTIVE', startDate: past, endDate: future },
        { userId: premiumSubscriber, planId: premiumPlan.id, status: 'ACTIVE', startDate: past, endDate: future },
        { userId: legacyAlias, planId: legacyAliasPlan.id, status: 'ACTIVE', startDate: past, endDate: future },
        { userId: expiredPremium, planId: premiumPlan.id, status: 'ACTIVE', startDate: past, endDate: expired },
        { userId: cancelledPremium, planId: premiumPlan.id, status: 'CANCELLED', startDate: past, endDate: future },
      ],
    });
    await prisma.userSubscriptionTrial.create({
      data: {
        userId: premiumTrial,
        grantedPlanKey: premiumPlan.key,
        status: 'ACTIVE',
        durationDays: 7,
        startAt: past,
        endAt: future,
        source: 'CANDIDATE_VISIBILITY_TEST',
      },
    });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.userSubscriptionTrial.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.seekerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.planEntitlement.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await prisma.subscriptionPlan.deleteMany({ where: { id: { in: createdPlanIds } } });
    if (createdEntitlementId) await prisma.entitlement.delete({ where: { id: createdEntitlementId } });
    if (createdLegacyAliasEntitlementId) await prisma.entitlement.delete({ where: { id: createdLegacyAliasEntitlementId } });
    else if (restoreLegacyAliasEntitlement) await prisma.entitlement.update({ where: { key: 'FEATURED_CANDIDATE' }, data: { isActive: false } });
    if (createdProfessionalVisibilityEntitlementId) await prisma.entitlement.delete({ where: { id: createdProfessionalVisibilityEntitlementId } });
    else if (restoreProfessionalVisibilityEntitlement) await prisma.entitlement.update({ where: { key: 'PROFESSIONAL_CANDIDATE_VISIBILITY' }, data: { isActive: false } });
    await prisma.$disconnect();
  });

  test('ranks canonical/legacy Premium boosts, keeps Professional and expired tiers normal, filters and paginates deterministically', async () => {
    const all = await listEmployerCandidates({ limit: 50 });
    const premiumIds = [candidates.premiumSubscriber, candidates.premiumTrial, candidates.legacyAlias].sort();
    const professionalIds = [candidates.professional];
    const normalIds = [candidates.basicAlpha, candidates.basicBeta, candidates.expiredPremium, candidates.cancelledPremium].sort();
    expect(all.candidates.map((candidate) => candidate.id)).toEqual([...premiumIds, ...professionalIds, ...normalIds]);
    expect(all.candidates.every((candidate) => candidate.availability === 'NOT_AVAILABLE')).toBe(true);

    for (const id of premiumIds) {
      const candidate = all.candidates.find((item) => item.id === id);
      expect(candidate).toMatchObject({ subscriptionTier: 'PREMIUM', featured: true, visibilityBoosted: true });
    }
    expect(all.candidates.find((candidate) => candidate.id === candidates.professional)).toMatchObject({ subscriptionTier: 'PROFESSIONAL', featured: false, visibilityBoosted: false });
    for (const id of normalIds) {
      const candidate = all.candidates.find((item) => item.id === id);
      expect(candidate).toMatchObject({ subscriptionTier: 'BASIC', featured: false, visibilityBoosted: false });
    }

    const pages = [];
    let cursor = null;
    do {
      const page = await listEmployerCandidates({ limit: 2, cursor });
      pages.push(...page.candidates.map((candidate) => candidate.id));
      cursor = page.pagination.nextCursor;
    } while (cursor);
    expect(pages).toEqual(all.candidates.map((candidate) => candidate.id));

    const largerPages = [];
    cursor = null;
    do {
      const page = await listEmployerCandidates({ limit: 3, cursor });
      largerPages.push(...page.candidates.map((candidate) => candidate.id));
      cursor = page.pagination.nextCursor;
    } while (cursor);
    expect(largerPages).toEqual(all.candidates.map((candidate) => candidate.id));
    expect(new Set(largerPages).size).toBe(all.candidates.length);

    const bySearch = await listEmployerCandidates({ limit: 50, search: 'Professional' });
    expect(bySearch.candidates.map((candidate) => candidate.id)).toEqual([candidates.professional]);
    const byLocation = await listEmployerCandidates({ limit: 50, location: 'Lagos' });
    expect(byLocation.candidates.map((candidate) => candidate.id)).toEqual([candidates.premiumSubscriber, candidates.premiumTrial, candidates.legacyAlias, candidates.basicAlpha, candidates.basicBeta].sort((left, right) => {
      const priority = (id) => premiumIds.includes(id) ? 2 : professionalIds.includes(id) ? 1 : 0;
      return priority(right) - priority(left) || left.localeCompare(right);
    }));
    const bySkill = await listEmployerCandidates({ limit: 50, skill: 'React' });
    expect(bySkill.candidates.map((candidate) => candidate.id)).toEqual([candidates.premiumSubscriber, candidates.legacyAlias, candidates.basicAlpha].sort((left, right) => {
      const priority = (id) => premiumIds.includes(id) ? 2 : professionalIds.includes(id) ? 1 : 0;
      return priority(right) - priority(left) || left.localeCompare(right);
    }));
  });

  test('availability changes do not affect visibility, and persisted subscription downgrades/expiry clear stale tiers', async () => {
    await prisma.seekerProfile.update({
      where: { userId: candidates.professional },
      data: { availability: 'AVAILABLE_NOW' },
    });
    let result = await listEmployerCandidates({ limit: 50 });
    expect(result.candidates.find(({ id }) => id === candidates.professional)).toMatchObject({
      availability: 'AVAILABLE_NOW',
      subscriptionTier: 'PROFESSIONAL',
      featured: false,
      visibilityBoosted: false,
    });

    await prisma.subscription.updateMany({
      where: { userId: candidates.premiumSubscriber, status: 'ACTIVE' },
      data: { planId: plans.professional.id },
    });
    result = await listEmployerCandidates({ limit: 50 });
    expect(result.candidates.find(({ id }) => id === candidates.premiumSubscriber)).toMatchObject({
      subscriptionTier: 'PROFESSIONAL',
      featured: false,
      visibilityBoosted: false,
    });

    await prisma.subscription.updateMany({
      where: { userId: candidates.premiumSubscriber, status: 'ACTIVE' },
      data: { planId: plans.basic.id },
    });
    result = await listEmployerCandidates({ limit: 50 });
    expect(result.candidates.find(({ id }) => id === candidates.premiumSubscriber)).toMatchObject({
      subscriptionTier: 'BASIC',
      featured: false,
      visibilityBoosted: false,
    });

    await prisma.subscription.updateMany({
      where: { userId: candidates.premiumSubscriber, status: 'ACTIVE' },
      data: { planId: plans.premium.id },
    });
    result = await listEmployerCandidates({ limit: 50 });
    expect(result.candidates.find(({ id }) => id === candidates.premiumSubscriber)).toMatchObject({
      subscriptionTier: 'PREMIUM',
      featured: true,
      visibilityBoosted: true,
    });

    await prisma.subscription.updateMany({
      where: { userId: candidates.premiumSubscriber, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    await prisma.subscription.updateMany({
      where: { userId: candidates.professional, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    result = await listEmployerCandidates({ limit: 50 });
    expect(result.candidates.find(({ id }) => id === candidates.premiumSubscriber)).toMatchObject({
      subscriptionTier: 'BASIC',
      featured: false,
      visibilityBoosted: false,
    });
    expect(result.candidates.find(({ id }) => id === candidates.professional)).toMatchObject({
      subscriptionTier: 'BASIC',
      featured: false,
      visibilityBoosted: false,
    });
  });
});

if (!databaseConfigured) {
  test('requires EMPLOYER_VISIBILITY_TEST_DATABASE_URL, PHASE4_TEST_DATABASE_URL, or TEST_DATABASE_URL for PostgreSQL verification', () => {
    expect(databaseConfigured).toBe(false);
  });
}