import { prisma } from '../config/database.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';
import { resolveEffectiveEntitlements } from './subscriptionEntitlement.service.js';
import { subscriptionPlanFeatureDefaults } from './subscriptionFoundation.service.js';

export const matchesJobAlert = (alert, job) => {
  const haystack = [job.title, job.description, job.location, ...(job.skills ?? [])].join(' ').toLowerCase();
  if (alert.keywords && !alert.keywords.toLowerCase().split(/[,\s]+/).filter(Boolean).every((term) => haystack.includes(term))) return false;
  if (alert.location && !job.location.toLowerCase().includes(alert.location.toLowerCase())) return false;
  if (alert.jobType && alert.jobType !== job.jobType) return false;
  if (alert.workArrangement && alert.workArrangement !== job.workArrangement) return false;
  if (alert.skills?.length && !alert.skills.some((skill) => (job.skills ?? []).some((jobSkill) => jobSkill.toLowerCase() === skill.toLowerCase()))) return false;

  const compensation = job.jobType === 'FREELANCE_PROJECT'
    ? { minimum: job.freelanceCompensation?.projectAmount, maximum: job.freelanceCompensation?.projectAmount }
    : { minimum: job.employmentCompensation?.salaryMin, maximum: job.employmentCompensation?.salaryMax };
  if (alert.salaryMin != null && (compensation.maximum == null || Number(compensation.maximum) < Number(alert.salaryMin))) return false;
  if (alert.salaryMax != null && (compensation.minimum == null || Number(compensation.minimum) > Number(alert.salaryMax))) return false;
  return true;
};

const getAlertLimit = (state) => {
  const defaults = subscriptionPlanFeatureDefaults[state.planKey] ?? subscriptionPlanFeatureDefaults.BASIC;
  const config = state.effectivePlan?.featureConfig && typeof state.effectivePlan.featureConfig === 'object' ? state.effectivePlan.featureConfig : {};
  if (config.jobAlertsLimit === null) return Infinity;
  return Number.isFinite(Number(config.jobAlertsLimit)) ? Number(config.jobAlertsLimit) : defaults.jobAlertsLimit ?? Infinity;
};

const processJobAlertsUnlocked = async ({ client, now, lookbackHours }) => {
  const allAlerts = await client.jobAlert.findMany({ where: { isActive: true }, include: { seeker: { select: { email: true } } }, orderBy: [{ seekerId: 'asc' }, { createdAt: 'asc' }] });
  const states = new Map();
  const alerts = [];
  for (const alert of allAlerts) {
    if (!states.has(alert.seekerId)) states.set(alert.seekerId, await resolveEffectiveEntitlements(alert.seekerId, client));
    const limit = getAlertLimit(states.get(alert.seekerId));
    const seekerAlerts = alerts.filter((item) => item.seekerId === alert.seekerId);
    if (Number.isFinite(limit) && seekerAlerts.length >= limit) continue;
    alerts.push(alert);
  }

  const fallbackStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  let matched = 0;
  for (const alert of alerts) {
    const since = alert.lastRunAt ?? fallbackStart;
    const jobs = await client.job.findMany({ where: { status: 'APPROVED', createdAt: { gt: since }, ...(alert.jobType ? { jobType: alert.jobType } : {}), ...(alert.workArrangement ? { workArrangement: alert.workArrangement } : {}) }, select: { id: true, title: true, description: true, location: true, skills: true, jobType: true, workArrangement: true, employmentCompensation: true, freelanceCompensation: true } });
    for (const job of jobs.filter((candidate) => matchesJobAlert(alert, candidate))) {
      await queueEmail({ recipientUserId: alert.seekerId, recipientEmail: alert.seeker.email, emailType: EMAIL_TYPES.JOB_ALERT_MATCH, eventKey: `job-alert:${alert.id}:${job.id}`, context: { title: `New job match: ${job.title}`, message: `${job.title} in ${job.location} matches your ${alert.name} alert.`, link: `/seeker/jobs/${job.id}`, linkLabel: 'View job' }, client });
      matched += 1;
    }
    await client.jobAlert.update({ where: { id: alert.id }, data: { lastRunAt: now } });
  }
  return { skipped: false, alertsProcessed: alerts.length, matchesQueued: matched };
};

export const processJobAlerts = async ({ now = new Date(), lookbackHours = 24 } = {}) => {
  if (typeof prisma.$transaction !== 'function' || typeof prisma.$queryRaw !== 'function') return processJobAlertsUnlocked({ client: prisma, now, lookbackHours });
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('leamjobs:job-alert-processor')) AS locked`;
    if (!rows[0]?.locked) return { skipped: true, alertsProcessed: 0, matchesQueued: 0 };
    return processJobAlertsUnlocked({ client: tx, now, lookbackHours });
  });
};
