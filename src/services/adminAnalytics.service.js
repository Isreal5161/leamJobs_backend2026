import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const jobStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'CLOSED'];
const applicationStatuses = ['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'REJECTED', 'ACCEPTED', 'PAYMENT_PENDING', 'WITHDRAWN'];
const paymentStatuses = ['PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUNDED'];
const paymentTypes = ['SUBSCRIPTION', 'CONTRACT_FUNDING', 'OTHER'];
const contractStatuses = ['PENDING', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'ENDED', 'DISPUTED', 'CANCELLED'];
const contractTypes = ['NORMAL_EMPLOYMENT', 'CONTRACT_PROJECT', 'FREELANCE_PROJECT'];
const subscriptionStatuses = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'FAILED'];
const fundedEscrowStatuses = ['FUNDED', 'RELEASE_ELIGIBLE', 'RELEASED'];
const currentlyFundedEscrowStatuses = ['FUNDED', 'RELEASE_ELIGIBLE'];

const countBy = (rows, key) => rows.map((row) => ({ [key]: row[key], count: row._count._all }));
const moneyRows = (rows, field = 'amount') => rows.map((row) => ({ currency: row.currency, amount: row._sum[field]?.toString() ?? '0' }));
const toTrendRows = (rows) => rows.map((row) => ({ date: row.date, count: Number(row.count) }));
const completeCounts = (values, rows, key) => values.map((value) => ({ [key]: value, count: rows.find((row) => row[key] === value)?._count._all ?? 0 }));

const trend = async (table, from, to, granularity) => {
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${granularity}, ${from}::timestamptz),
        date_trunc(${granularity}, (${to}::timestamptz - interval '1 microsecond')),
        CASE ${granularity}
          WHEN 'day' THEN interval '1 day'
          WHEN 'week' THEN interval '1 week'
          ELSE interval '1 month'
        END
      ) AS bucket
    ), counts AS (
      SELECT date_trunc(${granularity}, "createdAt" AT TIME ZONE 'UTC') AS bucket, COUNT(*)::int AS count
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE "createdAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
        AND "createdAt" < (${to}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1
    )
    SELECT to_char(GREATEST(buckets.bucket, ${from}::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
           COALESCE(counts.count, 0)::int AS count
    FROM buckets
    LEFT JOIN counts ON counts.bucket = buckets.bucket
    ORDER BY buckets.bucket
  `);
  return toTrendRows(rows);
};

const groupedCounts = (rows, key) => countBy(rows, key);

export const getAdminAnalytics = async ({ from, to, granularity }) => {
  const dateWhere = { gte: from, lt: to };
  const [
    totalUsers, totalSeekers, totalEmployers, activeUsers, verifiedUsers,
    totalJobs, totalApplications, totalContracts,
    jobsByStatus, applicationsByStatus, contractsByStatus, contractsByType,
    paymentsByStatus, paymentsByType, subscriptionsByStatus,
    successfulPayments, fundedEscrow, releasedEscrow, platformFees,
    usersTrend, jobsTrend, applicationsTrend, contractsTrend,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'SEEKER' } }),
    prisma.user.count({ where: { role: 'EMPLOYER' } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isVerified: true } }),
    prisma.job.count(),
    prisma.application.count(),
    prisma.contract.count(),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.contract.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.contract.groupBy({ by: ['type'], _count: { _all: true } }),
    prisma.payment.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: dateWhere } }),
    prisma.payment.groupBy({ by: ['paymentType'], _count: { _all: true }, where: { createdAt: dateWhere } }),
    prisma.subscription.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: dateWhere } }),
    prisma.payment.groupBy({ by: ['currency'], _sum: { amount: true }, where: { createdAt: dateWhere, status: 'SUCCESSFUL' } }),
    prisma.escrow.groupBy({ by: ['currency'], _sum: { fundedAmount: true }, where: { createdAt: dateWhere, status: { in: currentlyFundedEscrowStatuses } } }),
    prisma.escrow.groupBy({ by: ['currency'], _sum: { releasedAmount: true }, where: { createdAt: dateWhere, status: 'RELEASED' } }),
    // Platform fees are stored historical values, counted only for funded escrow states.
    prisma.escrow.groupBy({ by: ['currency'], _sum: { platformFeeAmount: true }, where: { createdAt: dateWhere, status: { in: fundedEscrowStatuses } } }),
    trend('User', from, to, granularity), trend('Job', from, to, granularity),
    trend('Application', from, to, granularity), trend('Contract', from, to, granularity),
  ]);

  return {
    dateRange: { from: from.toISOString(), to: to.toISOString(), granularity },
    summary: {
      totalUsers,
      totalSeekers,
      totalEmployers,
      activeUsers,
      verifiedUsers,
      totalJobs,
      pendingJobs: jobsByStatus.find((row) => row.status === 'PENDING')?._count._all ?? 0,
      approvedJobs: jobsByStatus.find((row) => row.status === 'APPROVED')?._count._all ?? 0,
      rejectedJobs: jobsByStatus.find((row) => row.status === 'REJECTED')?._count._all ?? 0,
      closedJobs: jobsByStatus.find((row) => row.status === 'CLOSED')?._count._all ?? 0,
      totalApplications,
      totalContracts,
    },
    trends: { users: usersTrend, jobs: jobsTrend, applications: applicationsTrend, contracts: contractsTrend },
    breakdowns: {
      jobsByStatus: completeCounts(jobStatuses, jobsByStatus, 'status'), applicationsByStatus: completeCounts(applicationStatuses, applicationsByStatus, 'status'),
      contractsByStatus: completeCounts(contractStatuses, contractsByStatus, 'status'), contractsByType: completeCounts(contractTypes, contractsByType, 'type'),
      paymentsByStatus: completeCounts(paymentStatuses, paymentsByStatus, 'status'), paymentsByType: completeCounts(paymentTypes, paymentsByType, 'paymentType'),
      subscriptionsByStatus: completeCounts(subscriptionStatuses, subscriptionsByStatus, 'status'),
    },
    financial: { successfulPayments: moneyRows(successfulPayments), fundedEscrow: moneyRows(fundedEscrow, 'fundedAmount'), releasedEscrow: moneyRows(releasedEscrow, 'releasedAmount'), platformFees: moneyRows(platformFees, 'platformFeeAmount') },
  };
};