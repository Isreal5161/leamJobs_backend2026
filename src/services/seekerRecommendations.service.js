import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { mapSeekerJob } from './seekerJobs.service.js';
import { normalizeSkills } from '../utils/skillNormalization.js';
import { hasEntitlement } from './subscriptionEntitlement.service.js';
import { publicCompanyLogoUrl } from '../utils/publicImageUrls.js';

export const FREE_RECOMMENDATION_WINDOW = 6;
export const PAID_RECOMMENDATION_WINDOW = 12;

const jobRecommendationSelect = {
  id: true,
  employerId: true,
  title: true,
  description: true,
  location: true,
  jobType: true,
  skills: true,
  requirements: true,
  createdAt: true,
  applicationDeadline: true,
  employer: { select: { employerProfile: {
    select: {
      companyName: true,
      companyDescription: true,
      website: true,
      industry: true,
      companySize: true,
      location: true,
      companyLogoUrl: true,
    },
  } } },
  employmentCompensation: { select: { salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true } },
  freelanceCompensation: { select: { projectAmount: true, currency: true } },
};

const findRankedRecommendationIds = async (seekerSkills, recommendationWindow, cursor) => {
  const seekerSkillKeys = seekerSkills.map((skill) => skill.key);
  const cursorRow = cursor ? Prisma.sql`OR id = ${cursor}` : Prisma.empty;

  return prisma.$queryRaw(Prisma.sql`
    WITH normalized_job_skills AS (
      SELECT
        job.id,
        job."createdAt",
        lower(trim(skill.value)) AS skill_key
      FROM "Job" AS job
      LEFT JOIN LATERAL unnest(job.skills) AS skill(value) ON TRUE
      WHERE trim(skill.value) <> ''
      GROUP BY job.id, job."createdAt", lower(trim(skill.value))
    ),
    scored_jobs AS (
      SELECT
        job.id,
        job."createdAt",
        CASE
          WHEN COUNT(normalized.skill_key) = 0 THEN 0
          ELSE ROUND(
            100.0 * COUNT(*) FILTER (WHERE normalized.skill_key IN (${Prisma.join(seekerSkillKeys)}))
            / COUNT(normalized.skill_key)
          )::int
        END AS match_score
      FROM "Job" AS job
      LEFT JOIN normalized_job_skills AS normalized ON normalized.id = job.id
      WHERE job.status = 'APPROVED'
        AND (job."applicationDeadline" IS NULL OR job."applicationDeadline" > CURRENT_TIMESTAMP)
      GROUP BY job.id, job."createdAt"
    ),
    ranked_jobs AS (
      SELECT
        id,
        match_score,
        ROW_NUMBER() OVER (ORDER BY match_score DESC, "createdAt" DESC, id ASC) AS recommendation_rank
      FROM scored_jobs
    )
    SELECT id, match_score AS "matchScore", recommendation_rank AS "recommendationRank"
    FROM ranked_jobs
    WHERE recommendation_rank <= ${recommendationWindow}
      ${cursorRow}
    ORDER BY recommendation_rank
  `);
};

export const findRelevantSeekerIdsForJob = async (jobSkills, client = prisma) => {
  const seekers = await findRelevantSeekersForJob(jobSkills, client);
  return seekers.map((seeker) => seeker.id);
};

export const findRelevantSeekersForJob = async (jobSkills, client = prisma) => {
  const normalizedJobSkills = normalizeSkills(jobSkills);
  if (normalizedJobSkills.length === 0) return [];
  const jobSkillKeys = new Set(normalizedJobSkills.map((skill) => skill.key));
  const seekers = await client.user?.findMany?.({
    where: { role: 'SEEKER', isActive: true, seekerProfile: { isNot: null } },
    select: { id: true, email: true, seekerProfile: { select: { skills: true } } },
  }) ?? [];
  return seekers
    .filter((seeker) => normalizeSkills(seeker.seekerProfile?.skills ?? []).some((skill) => jobSkillKeys.has(skill.key)))
    .map(({ id, email }) => ({ id, email }));
};

export const getSeekerRecommendations = async (seekerId, { limit, cursor }) => {
  const profile = await prisma.seekerProfile.findUnique({ where: { userId: seekerId }, select: { skills: true } });
  const seekerSkills = normalizeSkills(profile?.skills ?? []);
  if (seekerSkills.length === 0) return { recommendations: [], nextCursor: null };

    const hasBoost = await hasEntitlement(seekerId, 'PRIORITY_RECOMMENDATIONS');
  const recommendationWindow = hasBoost ? PAID_RECOMMENDATION_WINDOW : FREE_RECOMMENDATION_WINDOW;
  const effectiveLimit = Math.min(limit, recommendationWindow);
  const rankedIds = await findRankedRecommendationIds(seekerSkills, recommendationWindow, cursor);
  const jobs = await prisma.job.findMany({
    where: { id: { in: rankedIds.map(({ id }) => id) } },
    select: jobRecommendationSelect,
  });
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const ranked = rankedIds
    .map((rankedJob) => {
      const job = jobsById.get(rankedJob.id);
      if (!job) return null;
      const jobSkills = normalizeSkills(job.skills);
      const seekerSkillKeys = new Set(seekerSkills.map((skill) => skill.key));
      return {
        job,
        matchScore: Number(rankedJob.matchScore),
        matchedSkills: jobSkills.filter((skill) => seekerSkillKeys.has(skill.key)).map((skill) => skill.display),
        totalJobSkills: jobSkills.length,
      };
    })
    .filter(Boolean);
  const startIndex = cursor ? Math.max(0, ranked.findIndex((item) => item.job.id === cursor) + 1) : 0;
  const windowEnd = Math.min(recommendationWindow, ranked.length);
  const page = ranked.slice(startIndex, Math.min(startIndex + effectiveLimit, windowEnd));
  const nextItem = startIndex + effectiveLimit < windowEnd ? ranked[startIndex + effectiveLimit] : undefined;

  return {
    recommendations: page.map((item) => ({
      job: mapSeekerJob(item.job),
      matchScore: item.matchScore,
      matchedSkills: item.matchedSkills,
      totalJobSkills: item.totalJobSkills,
    })),
    nextCursor: nextItem?.job.id ?? null,
  };
};
