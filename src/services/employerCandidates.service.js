import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const MAX_LIMIT = 50;

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

const mapCandidate = (candidate) => ({
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
  visibilityBoosted: Boolean(candidate.visibilityBoosted),
  featured: Boolean(candidate.featured),
});

export const listEmployerCandidates = async ({ limit, cursor, search, location, skill }) => {
  const decodedCursor = decodeCursor(cursor);
  const cursorWhere = decodedCursor ? Prisma.sql`
    AND (
      COALESCE(ce."priority", 0) < ${decodedCursor.priority}
      OR (COALESCE(ce."priority", 0) = ${decodedCursor.priority} AND u."id" > ${decodedCursor.id})
    )
  ` : Prisma.empty;

  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH candidate_entitlements AS (
      SELECT
        s."userId",
        MAX(CASE
          WHEN e."key" = 'FEATURED_CANDIDATE' THEN 2
          WHEN e."key" = 'PROFILE_VISIBILITY_BOOST' THEN 1
          ELSE 0
        END)::int AS "priority",
        BOOL_OR(e."key" = 'FEATURED_CANDIDATE') AS "featured",
        BOOL_OR(e."key" = 'PROFILE_VISIBILITY_BOOST') AS "visibilityBoosted"
      FROM "Subscription" s
      INNER JOIN "SubscriptionPlan" spn ON spn."id" = s."planId"
      INNER JOIN "PlanEntitlement" pe ON pe."planId" = spn."id"
      INNER JOIN "Entitlement" e ON e."id" = pe."entitlementId"
      WHERE s."status" = 'ACTIVE'
        AND s."startDate" IS NOT NULL
        AND s."startDate" <= CURRENT_TIMESTAMP
        AND s."endDate" IS NOT NULL
        AND s."endDate" > CURRENT_TIMESTAMP
        AND e."isActive" = true
        AND e."key" IN ('FEATURED_CANDIDATE', 'PROFILE_VISIBILITY_BOOST')
      GROUP BY s."userId"
    )
    SELECT
      u."id",
      u."firstName",
      u."lastName",
      sp."professionalTitle",
      sp."bio",
      sp."location",
      sp."skills",
      sp."profilePictureUrl",
      COALESCE(ce."priority", 0)::int AS "priority",
      COALESCE(ce."featured", false) AS "featured",
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
