import { prisma } from '../config/database.js';
import { hasEntitlement, resolveEffectiveEntitlements } from './subscriptionEntitlement.service.js';
import { subscriptionPlanFeatureDefaults } from './subscriptionFoundation.service.js';
import { isAdvancedCvTemplate } from '../utils/cvTemplates.js';
import { createNotification } from './notification.service.js';
import { getLeamJobsEmployerEmail } from './leamjobsEmployer.service.js';

export class ApplicationDuplicateError extends Error {
  constructor() {
    super('You have already applied to this job');
    this.name = 'ApplicationDuplicateError';
    this.status = 409;
  }
}

export class ApplicationJobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'ApplicationJobNotFoundError';
    this.status = 404;
  }
}

export class ApplicationJobClosedError extends Error {
  constructor() {
    super('This job is no longer accepting applications');
    this.name = 'ApplicationJobClosedError';
    this.status = 404;
  }
}

const applicationSelect = {
  id: true,
  jobId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  contract: { select: { id: true } },
  job: {
    select: {
      id: true,
      title: true,
      employerId: true,
      jobType: true,
      location: true,
      employer: {
        select: {
          email: true,
          employerProfile: { select: { companyName: true } },
        },
      },
    },
  },
};

const applicationJobSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  jobType: true,
  createdAt: true,
  applicationDeadline: true,
  employer: { select: { email: true, employerProfile: { select: { companyName: true } } } },
};

const mapApplication = (application) => ({
  id: application.id,
  jobId: application.jobId,
  jobTitle: application.job.title,
  companyName: application.job.employer.employerProfile?.companyName ?? null,
  jobType: application.job.jobType,
  location: application.job.location,
  status: application.status,
  appliedAt: application.createdAt,
  updatedAt: application.updatedAt,
  contractId: application.contract?.id ?? null,
});

const buildLeamJobsCvSnapshot = (user, profile) => {
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
  const location = [profile?.city, profile?.state, profile?.country]
    .filter(Boolean)
    .join(', ') || profile?.location || '';

  return {
    personalInfo: {
      fullName,
      title: profile?.professionalTitle ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? undefined,
      location: location || undefined,
      linkedin: profile?.linkedinUrl ?? undefined,
    },
    summary: profile?.bio ?? '',
    experience: Array.isArray(profile?.experience)
      ? profile.experience.map((item) => ({
        jobTitle: item?.jobTitle ?? '',
        company: item?.company ?? '',
        startDate: item?.startDate ?? '',
        endDate: item?.endDate ?? '',
        currentlyWorking: Boolean(item?.currentlyWorking),
        description: item?.description ?? '',
      }))
      : [],
    education: Array.isArray(profile?.education)
      ? profile.education.map((item) => ({
        degree: item?.degree ?? '',
        school: item?.school ?? '',
        year: item?.year ?? '',
      }))
      : [],
    skills: Array.isArray(profile?.skills) ? profile.skills.filter(Boolean) : [],
    certifications: Array.isArray(profile?.certifications)
      ? profile.certifications.map((item) => ({
        name: item?.name ?? '',
        issuer: item?.issuer ?? '',
      }))
      : [],
    languages: Array.isArray(profile?.languages)
      ? profile.languages.map((item) => ({
        name: item?.name ?? '',
        proficiency: item?.proficiency ?? '',
      }))
      : [],
    projects: Array.isArray(profile?.projects)
      ? profile.projects.map((item) => ({
        name: item?.name ?? '',
        description: item?.description ?? '',
        technologies: Array.isArray(item?.technologies) ? item.technologies.filter(Boolean) : [],
        projectUrl: item?.projectUrl ?? '',
        githubUrl: item?.githubUrl ?? '',
        startDate: item?.startDate ?? '',
        endDate: item?.endDate ?? '',
      }))
      : [],
  };
};

const findApplicationJob = async (jobId) => {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'APPROVED' },
    select: applicationJobSelect,
  });

  if (!job) {
    throw new ApplicationJobNotFoundError();
  }

  if (job.applicationDeadline && job.applicationDeadline < new Date()) {
    throw new ApplicationJobClosedError();
  }

  return job;
};

const resolveAuthorizedUploadedCv = (seekerProfile, requestedResumeUrl, requestedResumeObjectKey) => {
  const profileResumeUrl = seekerProfile?.resumeUrl ?? null;
  const profileResumeObjectKey = seekerProfile?.resumeObjectKey ?? null;

  if (requestedResumeUrl && requestedResumeUrl !== profileResumeUrl) {
    const error = new Error('Uploaded CV does not belong to the authenticated seeker.');
    error.status = 400;
    throw error;
  }

  if (requestedResumeObjectKey && requestedResumeObjectKey !== profileResumeObjectKey) {
    const error = new Error('Uploaded CV does not belong to the authenticated seeker.');
    error.status = 400;
    throw error;
  }

  if (!profileResumeUrl && !profileResumeObjectKey) {
    const error = new Error('No uploaded CV is available for this profile.');
    error.status = 400;
    throw error;
  }

  return {
    resumeUrl: profileResumeUrl,
    resumeObjectKey: profileResumeObjectKey,
  };
};

export const getSeekerApplications = async (seekerId, { page = 1, limit = 50 } = {}) => {
  const where = { seekerId };
  const [applications, total, interviews] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: applicationSelect,
    }),
    prisma.application.count({ where }),
    prisma.application.count({
      where: { seekerId, status: 'INTERVIEW' },
    }),
  ]);

  return {
    applications: applications.map(mapApplication),
    summary: {
      total,
      interviews,
    },
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasNextPage: page < Math.max(1, Math.ceil(total / limit)), hasPreviousPage: page > 1 },
  };
};

export const createSeekerApplication = async (seekerId, { jobId, coverLetter, cvSource, resumeUrl, resumeObjectKey } = {}) => {
  const job = await findApplicationJob(jobId);

  const existingApplication = await prisma.application.findUnique({
    where: { seekerId_jobId: { seekerId, jobId } },
    select: { id: true },
  });

  if (existingApplication) {
    throw new ApplicationDuplicateError();
  }

  const [user, seekerProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: seekerId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    }),
    prisma.seekerProfile.findUnique({
      where: { userId: seekerId },
      select: {
        professionalTitle: true,
        bio: true,
        country: true,
        state: true,
        city: true,
        location: true,
        skills: true,
        education: true,
        experience: true,
        certifications: true,
        languages: true,
        projects: true,
        linkedinUrl: true,
        resumeUrl: true,
        resumeObjectKey: true,
        cvTemplate: true,
      },
    }),
  ]);

  const isTemplateApplication = cvSource === 'template';
  const isUploadApplication = cvSource === 'upload';

  if (isTemplateApplication && isAdvancedCvTemplate(seekerProfile?.cvTemplate)) {
    const canUseAdvancedCv = await hasEntitlement(seekerId, 'ADVANCED_CV');
    if (!canUseAdvancedCv) {
      const error = new Error('This CV presentation requires an active Advanced CV entitlement.');
      error.status = 403;
      throw error;
    }
  }

  const uploadedCv = isUploadApplication
    ? resolveAuthorizedUploadedCv(seekerProfile, resumeUrl, resumeObjectKey)
    : { resumeUrl: seekerProfile?.resumeUrl ?? null, resumeObjectKey: seekerProfile?.resumeObjectKey ?? null };

  const applicationResumeUrl = isTemplateApplication ? null : uploadedCv.resumeUrl;
  const applicationResumeObjectKey = isTemplateApplication ? null : uploadedCv.resumeObjectKey;
  const snapshotPayload = isTemplateApplication ? buildLeamJobsCvSnapshot(user, seekerProfile) : null;
  const isLeamJobsJob = job.employer?.email?.trim().toLowerCase() === getLeamJobsEmployerEmail();
  const adminRecipients = isLeamJobsJob
    ? await prisma.user?.findMany?.({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true, email: true },
    }) ?? []
    : [];
  const entitlementState = await resolveEffectiveEntitlements(seekerId);
  const defaults = subscriptionPlanFeatureDefaults[entitlementState.planKey] ?? subscriptionPlanFeatureDefaults.BASIC;
  const config = entitlementState.effectivePlan?.featureConfig && typeof entitlementState.effectivePlan.featureConfig === 'object' ? entitlementState.effectivePlan.featureConfig : {};
  const applicationLimit = config.applicationLimit === null
    ? Infinity
    : Number.isFinite(Number(config.applicationLimit))
      ? Number(config.applicationLimit)
      : defaults.applicationLimit ?? Infinity;

  try {
    const application = await prisma.$transaction(async (transaction) => {
      if (typeof transaction.$queryRaw === 'function') await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${seekerId} FOR UPDATE`;
      if (Number.isFinite(applicationLimit)) {
        const periodStart = new Date();
        periodStart.setUTCDate(1);
        periodStart.setUTCHours(0, 0, 0, 0);
        const applicationCount = await transaction.application.count({ where: { seekerId, createdAt: { gte: periodStart } } });
        if (applicationCount >= applicationLimit) {
          const error = new Error(`Your ${entitlementState.planKey} plan allows ${applicationLimit} applications per month.`);
          error.status = 403;
          error.publicCode = 'APPLICATION_LIMIT_REACHED';
          throw error;
        }
      }
      const created = await transaction.application.create({
        data: {
          seekerId,
          jobId,
          coverLetter,
          resumeUrl: applicationResumeUrl,
          resumeObjectKey: applicationResumeObjectKey,
          resumeVersion: applicationResumeObjectKey ?? null,
          resumeSubmittedAt: new Date(),
          ...(cvSource ? { coverLetter } : {}),
        },
        select: applicationSelect,
      });

      if (isTemplateApplication) {
        await transaction.applicationCvSnapshot.create({
          data: {
            applicationId: created.id,
            source: 'LEAMJOBS_TEMPLATE',
            templateId: seekerProfile?.cvTemplate ?? 'modern',
            templateName: seekerProfile?.cvTemplate ?? 'modern',
            snapshot: snapshotPayload,
          },
        });
      }

      const seekerName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'A seeker';
      await createNotification({
        recipientUserId: created.job.employerId,
        recipientEmail: created.job.employer?.email,
        actorUserId: seekerId,
        type: 'INFO',
        category: 'APPLICATION',
        eventKey: `application:submitted:${created.id}`,
        title: 'New application received',
        message: `${seekerName} applied for "${created.job.title}".`,
        link: '/employer/applicants',
      }, transaction).catch(() => undefined);

      if (isLeamJobsJob) {
        await Promise.all(adminRecipients.map((admin) => createNotification({
          recipientUserId: admin.id,
          recipientEmail: admin.email,
          actorUserId: seekerId,
          type: 'INFO',
          category: 'APPLICATION',
          eventKey: `application:submitted:admin:${created.id}`,
          title: 'New LeamJobs application received',
          message: `${seekerName} applied for "${created.job.title}".`,
          link: `/admin/jobs/${created.jobId}/applicants`,
        }, transaction).catch(() => undefined)));
      }

      return created;
    });

    return mapApplication(application);
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new ApplicationDuplicateError();
    }

    throw error;
  }
};
