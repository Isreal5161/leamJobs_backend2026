import { prisma } from '../config/database.js';
import { mapSeekerJob } from './seekerJobs.service.js';
import { normalizeSkills } from '../utils/skillNormalization.js';

const jobRecommendationSelect = {
  id: true,
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

export const getSeekerRecommendations = async (seekerId, { limit, cursor }) => {
  const profile = await prisma.seekerProfile.findUnique({ where: { userId: seekerId }, select: { skills: true } });
  const seekerSkills = normalizeSkills(profile?.skills ?? []);
  if (seekerSkills.length === 0) return { recommendations: [], nextCursor: null };

  const jobs = await prisma.job.findMany({ where: { status: 'APPROVED' }, select: jobRecommendationSelect });
  const ranked = rankRecommendations(jobs, seekerSkills);
  const startIndex = cursor ? Math.max(0, ranked.findIndex((item) => item.job.id === cursor) + 1) : 0;
  const page = ranked.slice(startIndex, startIndex + limit);
  const nextItem = ranked[startIndex + limit];

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
