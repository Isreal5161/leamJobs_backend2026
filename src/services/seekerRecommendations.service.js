import { prisma } from '../config/database.js';
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

const rankRecommendations = (jobs, seekerSkills) => jobs.map((job) => {
  const jobSkills = normalizeSkills(job.skills);
  const seekerSkillKeys = new Set(seekerSkills.map((skill) => skill.key));
  const matchedSkills = jobSkills.filter((skill) => seekerSkillKeys.has(skill.key)).map((skill) => skill.display);
  const matchScore = jobSkills.length === 0 ? 0 : Math.round((matchedSkills.length / jobSkills.length) * 100);
  return {
    job,
    matchScore,
    matchedSkills,
    totalJobSkills: jobSkills.length,
  };
}).sort((first, second) => {
  const scoreDifference = second.matchScore - first.matchScore;
  if (scoreDifference !== 0) return scoreDifference;
  const dateDifference = new Date(second.job.createdAt).getTime() - new Date(first.job.createdAt).getTime();
  if (dateDifference !== 0) return dateDifference;
  return first.job.id.localeCompare(second.job.id);
});

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

  const hasBoost = await hasEntitlement(seekerId, 'RECOMMENDATION_BOOST');
  const recommendationWindow = hasBoost ? PAID_RECOMMENDATION_WINDOW : FREE_RECOMMENDATION_WINDOW;
  const effectiveLimit = Math.min(limit, recommendationWindow);
  const jobs = await prisma.job.findMany({ where: { status: 'APPROVED', OR: [{ applicationDeadline: null }, { applicationDeadline: { gt: new Date() } }] }, select: jobRecommendationSelect });
  const ranked = rankRecommendations(jobs, seekerSkills);
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
