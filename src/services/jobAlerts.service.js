import { prisma } from '../config/database.js';
import { EMAIL_TYPES, queueEmail } from './email.service.js';
import { resolveEffectiveEntitlements } from './subscriptionEntitlement.service.js';
import { subscriptionPlanFeatureDefaults } from './subscriptionFoundation.service.js';

const ALERT_BATCH_SIZE = 100;
const JOB_BATCH_SIZE = 100;

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
  const states = new Map();
  const alertCounts = new Map();
  const fallbackStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  let matched = 0;
  let alertCursor;
  let alertsProcessed = 0;

  while (true) {
    const alertBatch = await client.jobAlert.findMany({
      where: { isActive: true },
      include: { seeker: { select: { email: true } } },
      orderBy: [{ seekerId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: ALERT_BATCH_SIZE,
      ...(alertCursor ? { cursor: { id: alertCursor }, skip: 1 } : {}),
    });
    if (alertBatch.length === 0) break;

    for (const alert of alertBatch) {
      if (!states.has(alert.seekerId)) {
        states.set(alert.seekerId, await resolveEffectiveEntitlements(alert.seekerId, client));
        alertCounts.set(alert.seekerId, 0);
      }
      const limit = getAlertLimit(states.get(alert.seekerId));
      const alertCount = alertCounts.get(alert.seekerId);
      if (Number.isFinite(limit) && alertCount >= limit) continue;
      alertCounts.set(alert.seekerId, alertCount + 1);
      alertsProcessed += 1;

      const since = alert.lastRunAt ?? fallbackStart;
      let jobCursor;
      while (true) {
        const jobs = await client.job.findMany({
          where: {
            status: 'APPROVED',
            createdAt: { gt: since },
            ...(alert.jobType ? { jobType: alert.jobType } : {}),
            ...(alert.workArrangement ? { workArrangement: alert.workArrangement } : {}),
          },
          select: { id: true, title: true, description: true, location: true, skills: true, jobType: true, workArrangement: true, employmentCompensation: true, freelanceCompensation: true },
          orderBy: { id: 'asc' },
          take: JOB_BATCH_SIZE,
          ...(jobCursor ? { cursor: { id: jobCursor }, skip: 1 } : {}),
        });
        for (const job of jobs) {
          if (!matchesJobAlert(alert, job)) continue;
          await queueEmail({ recipientUserId: alert.seekerId, recipientEmail: alert.seeker.email, emailType: EMAIL_TYPES.JOB_ALERT_MATCH, eventKey: `job-alert:${alert.id}:${job.id}`, context: { title: `New job match: ${job.title}`, message: `${job.title} in ${job.location} matches your ${alert.name} alert.`, link: `/seeker/jobs/${job.id}`, linkLabel: 'View job' }, client });
          matched += 1;
        }
        if (jobs.length < JOB_BATCH_SIZE) break;
        jobCursor = jobs[jobs.length - 1].id;
      }
      await client.jobAlert.update({ where: { id: alert.id }, data: { lastRunAt: now } });
    }
    if (alertBatch.length < ALERT_BATCH_SIZE) break;
    alertCursor = alertBatch[alertBatch.length - 1].id;
  }
  return { skipped: false, alertsProcessed, matchesQueued: matched };
};

export const processJobAlerts = async ({ now = new Date(), lookbackHours = 24 } = {}) => {
  if (typeof prisma.$transaction !== 'function' || typeof prisma.$queryRaw !== 'function') return processJobAlertsUnlocked({ client: prisma, now, lookbackHours });
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('leamjobs:job-alert-processor')) AS locked`;
    if (!rows[0]?.locked) return { skipped: true, alertsProcessed: 0, matchesQueued: 0 };
    return processJobAlertsUnlocked({ client: tx, now, lookbackHours });
  });
};
