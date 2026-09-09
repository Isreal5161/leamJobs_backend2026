import { prisma } from '../config/database.js';

export const getEmployerIdentity = (user) => ({
  id: user.sub,
  role: user.role,
});

const DASHBOARD_JOB_LIMIT = 3;
const DASHBOARD_APPLICATION_LIMIT = 3;

const applicationStatuses = ['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'ACCEPTED'];

const countApplicationsByStatus = (employerId, status) => prisma.application.count({
  where: {
    status,
    job: { employerId },
  },
});

export const getEmployerDashboard = async (employerId) => {
  const [openRoles, ...applicationCounts] = await Promise.all([
    prisma.job.count({
      where: {
        employerId,
        status: 'APPROVED',
      },
    }),
    ...applicationStatuses.map((status) => countApplicationsByStatus(employerId, status)),
    prisma.job.findMany({
      where: {
        employerId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_JOB_LIMIT,
      select: {
        id: true,
        title: true,
        location: true,
        jobType: true,
        status: true,
        createdAt: true,
        _count: { select: { applications: true } },
      },
    }),
    prisma.application.findMany({
      where: { job: { employerId } },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_APPLICATION_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
        seeker: { select: { firstName: true, lastName: true } },
        job: { select: { title: true } },
      },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    applicationStatuses.map((status, index) => [status, applicationCounts[index]]),
  );

  const recentJobs = applicationCounts[applicationStatuses.length];
  const recentApplications = applicationCounts[applicationStatuses.length + 1];

  return {
    stats: {
      openRoles,
      newApplicants: statusCounts.APPLIED,
      interviews: statusCounts.INTERVIEW,
      averageMatchScore: null,
    },
    pipeline: {
      applied: statusCounts.APPLIED,
      reviewing: statusCounts.REVIEWING,
      shortlisted: statusCounts.SHORTLISTED,
      interview: statusCounts.INTERVIEW,
      accepted: statusCounts.ACCEPTED,
    },
    recentJobs: recentJobs.map((job) => ({
      id: job.id,
      title: job.title,
      location: job.location,
      jobType: job.jobType,
      status: job.status,
      applicantCount: job._count.applications,
      createdAt: job.createdAt,
    })),
    recentApplications: recentApplications.map((application) => ({
      id: application.id,
      seekerName: `${application.seeker.firstName} ${application.seeker.lastName}`.trim(),
      jobTitle: application.job.title,
      status: application.status,
      appliedAt: application.createdAt,
    })),
  };
};