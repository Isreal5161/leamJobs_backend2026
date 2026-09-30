import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { readObject } from './storage/storage.service.js';

const MAX_LIMIT = 50;
const premiumVisibilityEntitlementKeys = Prisma.sql`'PROFILE_VISIBILITY_BOOST', 'FEATURED_CANDIDATE'`;
const candidateVisibilityEntitlementKeys = Prisma.sql`'PROFILE_VISIBILITY_BOOST', 'FEATURED_CANDIDATE', 'PROFESSIONAL_CANDIDATE_VISIBILITY'`;
const candidateEntitlementsCte = Prisma.sql`candidate_entitlements AS (
  SELECT
    s."userId",
    MAX(CASE
      WHEN e."key" IN (${premiumVisibilityEntitlementKeys}) THEN 2
      WHEN e."key" = 'PROFESSIONAL_CANDIDATE_VISIBILITY' THEN 1
      ELSE 0
    END)::int AS "priority",
    BOOL_OR(e."key" IN (${premiumVisibilityEntitlementKeys})) AS "visibilityBoosted",
    BOOL_OR(e."key" = 'PROFESSIONAL_CANDIDATE_VISIBILITY') AS "professionalVisibility"
  FROM (
    SELECT s."userId", s."planId"
    FROM "Subscription" s
    WHERE s."status" = 'ACTIVE'
      AND s."startDate" IS NOT NULL
      AND s."startDate" <= CURRENT_TIMESTAMP
      AND s."endDate" IS NOT NULL
      AND s."endDate" > CURRENT_TIMESTAMP
    UNION ALL
    SELECT trial."userId", spn_trial."id" AS "planId"
    FROM "UserSubscriptionTrial" trial
    INNER JOIN "SubscriptionPlan" spn_trial ON spn_trial."key" = trial."grantedPlanKey"
    WHERE trial."status" = 'ACTIVE'
      AND trial."startAt" <= CURRENT_TIMESTAMP
      AND trial."endAt" > CURRENT_TIMESTAMP
  ) s
  INNER JOIN "SubscriptionPlan" spn ON spn."id" = s."planId"
  INNER JOIN "PlanEntitlement" pe ON pe."planId" = spn."id"
  INNER JOIN "Entitlement" e ON e."id" = pe."entitlementId"
  WHERE e."isActive" = true
    AND e."key" IN (${candidateVisibilityEntitlementKeys})
  GROUP BY s."userId"
)`;

export const getEmployerCandidateSubscriptionTiers = async (candidateIds) => {
  const userIds = [...new Set(candidateIds)].filter(Boolean);
  if (!userIds.length) return new Map();

  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH ${candidateEntitlementsCte}
    SELECT
      u."id",
      CASE
        WHEN COALESCE(ce."visibilityBoosted", false) THEN 'PREMIUM'
        WHEN COALESCE(ce."professionalVisibility", false) THEN 'PROFESSIONAL'
        ELSE 'BASIC'
      END AS "subscriptionTier",
      COALESCE(ce."visibilityBoosted", false) AS "visibilityBoosted"
    FROM "User" u
    LEFT JOIN candidate_entitlements ce ON ce."userId" = u."id"
    WHERE u."id" IN (${Prisma.join(userIds)})
  `);

  return new Map(rows.map((row) => [row.id, {
    subscriptionTier: row.subscriptionTier ?? 'BASIC',
    featured: Boolean(row.visibilityBoosted),
    visibilityBoosted: Boolean(row.visibilityBoosted),
  }]));
};

const decodeCursor = (cursor) => {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(decoded.priority) || ![0, 1, 2].includes(decoded.priority)
      || typeof decoded.id !== 'string' || !decoded.id) {
      throw new Error('Invalid cursor');
    }
    return decoded;
  } catch {
    const error = new Error('Invalid candidate cursor');
    error.status = 400;
    throw error;
  }
};

const encodeCursor = (priority, id) => Buffer.from(JSON.stringify({ priority, id }), 'utf8').toString('base64url');

const candidateWhere = ({ search, location, skill }) => {
  const conditions = [
    Prisma.sql`u."role" = 'SEEKER'`,
    Prisma.sql`u."isActive" = true`,
  ];

  if (search?.trim()) {
    const value = search.trim();
    conditions.push(Prisma.sql`(
      u."firstName" ILIKE '%' || ${value} || '%'
      OR u."lastName" ILIKE '%' || ${value} || '%'
      OR sp."professionalTitle" ILIKE '%' || ${value} || '%'
    )`);
  }

  if (location?.trim()) {
    conditions.push(Prisma.sql`sp."location" ILIKE '%' || ${location.trim()} || '%'`);
  }

  if (skill?.trim()) {
    conditions.push(Prisma.sql`${skill.trim()} = ANY(sp."skills")`);
  }

  return Prisma.join(conditions, ' AND ');
};

const mapCandidate = (candidate) => {
  const visibilityBoosted = Boolean(candidate.visibilityBoosted);
  return {
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    profile: {
      professionalTitle: candidate.professionalTitle,
      bio: candidate.bio,
      location: candidate.location,
      skills: candidate.skills ?? [],
      profilePictureUrl: candidate.profilePictureUrl,
    },
    featured: visibilityBoosted,
    visibilityBoosted,
    subscriptionTier: candidate.subscriptionTier ?? 'BASIC',
    availability: candidate.availability ?? 'NOT_AVAILABLE',
  };
};

export const getEmployerCandidateProfilePicture = async (candidateId) => {
  const candidate = await prisma.user.findFirst({
    where: { id: candidateId, role: 'SEEKER', isActive: true },
    select: { seekerProfile: { select: { profilePictureKey: true } } },
  });
  const objectKey = candidate?.seekerProfile?.profilePictureKey;
  if (!objectKey) {
    const error = new Error('Candidate profile picture not found.');
    error.status = 404;
    throw error;
  }
  return { buffer: await readObject(objectKey), objectKey };
};

export const listEmployerCandidates = async ({ limit, cursor, search, location, skill }) => {
  const decodedCursor = decodeCursor(cursor);
  const cursorWhere = decodedCursor ? Prisma.sql`
    AND (
      COALESCE(ce."priority", 0) < ${decodedCursor.priority}
      OR (COALESCE(ce."priority", 0) = ${decodedCursor.priority} AND u."id" > ${decodedCursor.id})
    )
  ` : Prisma.empty;

  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH ${candidateEntitlementsCte}
    SELECT
      u."id",
      u."firstName",
      u."lastName",
      sp."professionalTitle",
      sp."bio",
      sp."location",
      sp."skills",
      sp."profilePictureUrl",
      sp."availability",
      COALESCE(ce."priority", 0)::int AS "priority",
      CASE
        WHEN COALESCE(ce."visibilityBoosted", false) THEN 'PREMIUM'
        WHEN COALESCE(ce."professionalVisibility", false) THEN 'PROFESSIONAL'
        ELSE 'BASIC'
      END AS "subscriptionTier",
      COALESCE(ce."visibilityBoosted", false) AS "visibilityBoosted"
    FROM "User" u
    INNER JOIN "SeekerProfile" sp ON sp."userId" = u."id"
    LEFT JOIN candidate_entitlements ce ON ce."userId" = u."id"
    WHERE ${candidateWhere({ search, location, skill })}
      ${cursorWhere}
    ORDER BY COALESCE(ce."priority", 0) DESC, u."id" ASC
    LIMIT ${Math.min(limit, MAX_LIMIT) + 1}
  `);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const pageRows = rows;
  const last = pageRows.at(-1);

  return {
    candidates: pageRows.map(mapCandidate),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(Number(last.priority), last.id) : null,
    },
  };
};
