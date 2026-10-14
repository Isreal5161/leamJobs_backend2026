import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { readObject } from './storage/storage.service.js';
import { getActivePlatformFeePercentage } from './platformFee.service.js';
import { createNotification } from './notification.service.js';
import { calculateSkillMatch } from '../utils/skillNormalization.js';
import { getEmployerCandidateSubscriptionTiers } from './employerCandidates.service.js';
import {
  canPossiblyCancelContract,
  cancelEmployerFreelanceContract,
  findContractFundingPayments,
  hasNoContractFinancialHistory,
  isContractCancellationAvailable,
  isSafelyCancelledContract,
} from './contract.service.js';

const applicationStatuses = ['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'REJECTED', 'ACCEPTED', 'WITHDRAWN'];

export class EmployerApplicationNotFoundError extends Error {
  constructor() {
    super('Application not found');
    this.name = 'EmployerApplicationNotFoundError';
    this.status = 404;
  }
}

export class EmployerApplicationResumeUnavailableError extends Error {
  constructor() {
    super('CV not available for this application');
    this.name = 'EmployerApplicationResumeUnavailableError';
    this.status = 404;
  }
}

export class EmployerApplicationProfilePictureUnavailableError extends Error {
  constructor() {
    super('Profile picture not available for this application');
    this.name = 'EmployerApplicationProfilePictureUnavailableError';
    this.status = 404;
  }
}

export class FreelanceContractCreationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FreelanceContractCreationError';
    this.status = 422;
  }
}

export class ContractJobSelectionError extends Error {
  constructor(message, publicCode = 'CONTRACT_SELECTION_CONFLICT') {
    super(message);
    this.name = 'ContractJobSelectionError';
    this.status = 409;
    this.publicCode = publicCode;
    this.publicMessage = message;
  }
}

const applicantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  seekerProfile: {
    select: {
      professionalTitle: true,
      profilePictureUrl: true,
      country: true,
      state: true,
      city: true,
      location: true,
      bio: true,
      skills: true,
      availability: true,
      education: true,
      experience: true,
      certifications: true,
      languages: true,
      projects: true,
      linkedinUrl: true,
      resumeObjectKey: true,
      cvTemplate: true,
    },
  },
};

const listSelect = {
  id: true,
  jobId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  contract: {
    select: {
      id: true,
      employerId: true,
      type: true,
      status: true,
      cancelledAt: true,
      completedAt: true,
      endedAt: true,
      applicationId: true,
      application: { select: { id: true, jobId: true, seekerId: true, status: true } },
      job: { select: { id: true, employerId: true, jobType: true, engagementType: true } },
      disputes: { select: { id: true } },
      ledgerEntries: { select: { id: true } },
      freelanceDetails: {
        select: {
          contractId: true,
          workStatus: true,
          completionSubmittedAt: true,
          employerConfirmedAt: true,
          seekerConfirmedAt: true,
          employerCompletionConfirmedAt: true,
          escrow: {
            select: {
              id: true,
              freelanceContractId: true,
              status: true,
              fundedAmount: true,
              releasedAmount: true,
              refundedAmount: true,
              fundedAt: true,
              releasedAt: true,
              cancelledAt: true,
              releaseEligibleAt: true,
              refunds: { select: { id: true } },
              disputes: { select: { id: true } },
              ledgerEntries: { select: { id: true } },
              payments: {
                where: { paymentType: 'CONTRACT_FUNDING' },
                select: { id: true, status: true },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      },
    },
  },
  seeker: { select: applicantSelect },
  job: { select: { id: true, title: true, employerId: true, skills: true } },
};

const detailSelect = {
  id: true,
  jobId: true,
  status: true,
  coverLetter: true,
  resumeUrl: true,
  resumeObjectKey: true,
  resumeVersion: true,
  resumeSubmittedAt: true,
  createdAt: true,
  updatedAt: true,
  contract: { select: { id: true } },
  seeker: { select: applicantSelect },
  job: { select: { id: true, title: true, employerId: true, skills: true } },
  cvSnapshot: {
    select: {
      id: true,
      source: true,
      templateId: true,
      templateName: true,
      templateVersion: true,
      snapshotCapturedAt: true,
      snapshot: true,
    },
  },
};

const assertStatus = (status) => {
  if (!applicationStatuses.includes(status)) {
    const error = new Error('Invalid application status');
    error.status = 400;
    throw error;
  }
};

const mapApplicant = (seeker, jobSkills, subscription = {}) => {
  const profile = seeker.seekerProfile;
  const jobFitScore = calculateSkillMatch(profile?.skills ?? [], jobSkills ?? []).score;
  const visibilityBoosted = Boolean(subscription.visibilityBoosted);
  return {
    id: seeker.id,
    firstName: seeker.firstName,
    lastName: seeker.lastName,
    email: seeker.email,
    phone: seeker.phone ?? null,
    fullName: `${seeker.firstName} ${seeker.lastName}`.trim(),
    professionalTitle: profile?.professionalTitle ?? null,
    profilePictureUrl: profile?.profilePictureUrl ?? null,
    location: profile?.location ?? null,
    country: profile?.country ?? null,
    state: profile?.state ?? null,
    city: profile?.city ?? null,
    bio: profile?.bio ?? null,
    skills: profile?.skills ?? [],
    availability: profile?.availability ?? 'NOT_AVAILABLE',
    subscriptionTier: subscription.subscriptionTier ?? 'BASIC',
    featured: visibilityBoosted,
    visibilityBoosted,
    jobFitScore,
    education: profile?.education ?? null,
    experience: profile?.experience ?? null,
    certifications: profile?.certifications ?? null,
    languages: profile?.languages ?? null,
    projects: profile?.projects ?? null,
    linkedinUrl: profile?.linkedinUrl ?? null,
    cvTemplate: profile?.cvTemplate ?? null,
  };
};

const mapApplicationListItem = (application, subscription) => {
  const { id, ...applicant } = mapApplicant(application.seeker, application.job.skills, subscription);
  return {
    id: application.id,
    jobId: application.jobId,
    jobTitle: application.job.title,
    applicant,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    contractId: application.contract?.id ?? null,
    contractStatus: application.contract?.status ?? null,
    escrowStatus: application.contract?.freelanceDetails?.escrow?.status ?? null,
    paymentStatuses: application.contract?.freelanceDetails?.escrow?.payments?.map(({ status }) => status) ?? [],
    availableActions: { cancel: Boolean(application.contract?.availableActions?.cancel) },
    blocksSelection: application.contract?.blocksSelection
      ?? ['ACCEPTED', 'PAYMENT_PENDING'].includes(application.status),
  };
};

const mapApplicationDetail = (application, subscription) => {
  const snapshot = application.cvSnapshot ?? null;
  const source = snapshot
    ? 'template'
    : application.resumeObjectKey
      ? 'application'
      : application.seeker.seekerProfile?.resumeObjectKey
        ? 'profile'
        : application.seeker.seekerProfile?.cvTemplate
          ? 'template'
          : null;

  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    coverLetter: application.coverLetter,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    contractId: application.contract?.id ?? null,
    resume: {
      available: Boolean(source),
      source,
      submittedAt: application.resumeSubmittedAt,
      version: application.resumeVersion,
    },
    cvSnapshot: snapshot ? {
      id: snapshot.id,
      source: snapshot.source,
      templateId: snapshot.templateId ?? null,
      templateName: snapshot.templateName ?? null,
      templateVersion: snapshot.templateVersion ?? null,
      snapshotCapturedAt: snapshot.snapshotCapturedAt,
      snapshot: snapshot.snapshot,
    } : null,
    job: {
      id: application.job.id,
      title: application.job.title,
    },
    applicant: mapApplicant(application.seeker, application.job.skills, subscription),
  };
};

const mapApplicationDetailWithSubscription = async (application) => {
  const subscriptionTiers = await getEmployerCandidateSubscriptionTiers([application.seeker.id]);
  return mapApplicationDetail(application, subscriptionTiers.get(application.seeker.id));
};

const ownedApplicationWhere = (employerId, jobId, applicationId) => ({
  id: applicationId,
  jobId,
  job: { employerId },
});

const findOwnedApplication = (employerId, jobId, applicationId, select = detailSelect) => prisma.application.findFirst({
  where: ownedApplicationWhere(employerId, jobId, applicationId),
  select,
});

export const listEmployerApplications = async (employerId, jobId, { page = 1, limit = 50 } = {}) => {
  const where = { jobId, job: { employerId } };
  const [applications, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: listSelect,
    }),
    prisma.application.count({ where }),
  ]);
  const subscriptionTiers = await getEmployerCandidateSubscriptionTiers(applications.map(({ seeker }) => seeker.id));
  const applicationsWithActions = await Promise.all(applications.map(async (application) => {
    if (!application.contract) return application;

    const contract = {
      ...application.contract,
      application: { status: application.status },
      job: { ...application.contract.job, title: application.job.title },
    };
    const cancellationHistoryClear = canPossiblyCancelContract(contract)
      && await hasNoContractFinancialHistory(
        prisma,
        contract.id,
        contract.freelanceDetails?.escrow?.id,
        contract.employerId,
      );
    const safelyCancelled = await isSafelyCancelledContract(prisma, contract);
    return {
      ...application,
      contract: {
        ...contract,
        availableActions: { cancel: isContractCancellationAvailable(contract, cancellationHistoryClear) },
        blocksSelection: !safelyCancelled,
      },
    };
  }));

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    applications: applicationsWithActions.map((application) => mapApplicationListItem(application, subscriptionTiers.get(application.seeker.id))),
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
  };
};

export const getEmployerApplication = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId);
  if (!application) throw new EmployerApplicationNotFoundError();
  return mapApplicationDetailWithSubscription(application);
};

export const getEmployerApplicationProfilePicture = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId, {
    seeker: { select: { seekerProfile: { select: { profilePictureKey: true } } } },
  });
  const objectKey = application?.seeker?.seekerProfile?.profilePictureKey;
  if (!objectKey) throw new EmployerApplicationProfilePictureUnavailableError();
  return { buffer: await readObject(objectKey), objectKey };
};

export const updateEmployerApplicationStatus = async (employerId, jobId, applicationId, status) => {
  assertStatus(status);
  const application = await findOwnedApplication(employerId, jobId, applicationId, {
    id: true,
    contract: { select: { id: true, type: true } },
    job: { select: { jobType: true, engagementType: true } },
  });
  if (!application) throw new EmployerApplicationNotFoundError();

  if (status !== 'ACCEPTED') {
    if (['FREELANCE_PROJECT', 'CONTRACT_PROJECT'].includes(application.contract?.type)) {
      if (['REJECTED', 'WITHDRAWN'].includes(status)) {
        await cancelEmployerFreelanceContract({
          contractId: application.contract.id,
          employerId,
          applicationJobId: jobId,
        });
        return getEmployerApplication(employerId, jobId, applicationId);
      }
      throw new ContractJobSelectionError(
        'A selected contract candidate can only be rejected or withdrawn by cancelling the eligible, unfunded contract.',
        'CONTRACT_SELECTION_REQUIRES_CANCELLATION',
      );
    }
    if (application.contract) {
      throw new ContractJobSelectionError('This contract type cannot be rejected through the application workflow.');
    }
    const updated = await prisma.application.update({
      where: { id: application.id },
      data: { status },
      select: detailSelect,
    });
    if (application.status !== status) {
      await createNotification({
        recipientUserId: updated.seeker.id,
        actorUserId: employerId,
        type: status === 'REJECTED' ? 'WARNING' : 'INFO',
        category: 'APPLICATION',
        eventKey: `application:status:${updated.id}:${status}`,
        title: 'Application status updated',
        message: `Your application for ${updated.job.title} is now ${status.toLowerCase().replace('_', ' ')}.`,
        link: '/seeker/applications',
      }).catch(() => undefined);
    }
    return mapApplicationDetailWithSubscription(updated);
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Job"
      WHERE "id" = ${jobId}
      FOR UPDATE
    `;

    await transaction.$queryRaw`
      SELECT "id"
      FROM "Application"
      WHERE "id" = ${applicationId}
      FOR UPDATE
    `;

    const application = await transaction.application.findFirst({
      where: ownedApplicationWhere(employerId, jobId, applicationId),
      select: {
        id: true,
        jobId: true,
        seekerId: true,
        status: true,
        contract: { select: { id: true } },
        seeker: { select: { id: true } },
        job: {
          select: {
            id: true,
            employerId: true,
            jobType: true,
            engagementType: true,
            status: true,
            contractCompensation: { select: { amount: true, currency: true, duration: true, startMode: true, scheduledStartDate: true, expectedCompletionDate: true } },
            freelanceCompensation: { select: { projectAmount: true, currency: true } },
          },
        },
      },
    });

    if (!application) throw new EmployerApplicationNotFoundError();

    if (application.job.engagementType === 'CONTRACT') {
      throw new ContractJobSelectionError('Use the Contract Job selection and payment flow for contract applications');
    }

    if (application.job.jobType !== 'FREELANCE_PROJECT' || application.job.engagementType !== 'FREELANCE') {
      const updated = await transaction.application.update({
        where: { id: application.id },
        data: { status: 'ACCEPTED' },
        select: detailSelect,
      });

      await createNotification({
        recipientUserId: application.seeker.id,
        actorUserId: employerId,
        type: 'SUCCESS',
        category: 'APPLICATION',
        eventKey: `application:accepted:${updated.id}`,
        title: 'Your application was accepted',
        message: `You have been selected for ${updated.job.title}.`,
        link: `/seeker/applications`,
      }, transaction).catch(() => undefined);

      return mapApplicationDetailWithSubscription(updated);
    }

    if (!application.job.freelanceCompensation) {
      throw new FreelanceContractCreationError('Freelance compensation is unavailable for this job');
    }

    if (application.contract) {
      const existing = await transaction.application.findFirst({
        where: { id: application.id },
        select: detailSelect,
      });
      return mapApplicationDetailWithSubscription(existing);
    }

    const otherAcceptedApplication = await transaction.application.findFirst({
      where: {
        jobId: application.job.id,
        id: { not: application.id },
        status: 'ACCEPTED',
      },
      select: { id: true },
    });
    if (otherAcceptedApplication) {
      throw new ContractJobSelectionError(
        'Another candidate is already selected for this project. Resolve the existing selection before selecting a replacement.',
        'FREELANCE_SELECTION_UNFUNDED_CONTRACT',
      );
    }

    const otherFreelanceContracts = await transaction.contract.findMany({
      where: {
        jobId: application.job.id,
        type: 'FREELANCE_PROJECT',
        applicationId: { not: application.id },
      },
      select: {
        id: true,
        jobId: true,
        seekerId: true,
        employerId: true,
        status: true,
        cancelledAt: true,
        applicationId: true,
        application: { select: { id: true, jobId: true, seekerId: true, status: true } },
        job: { select: { id: true, employerId: true } },
        disputes: { select: { id: true } },
        ledgerEntries: { select: { id: true } },
        freelanceDetails: {
          select: {
            contractId: true,
            workStatus: true,
            escrow: {
              select: {
                freelanceContractId: true,
                cancelledAt: true,
                status: true,
                fundedAmount: true,
                releasedAmount: true,
                refundedAmount: true,
                fundedAt: true,
                releasedAt: true,
                payments: {
                  where: { paymentType: 'CONTRACT_FUNDING' },
                  select: { status: true },
                },
                refunds: { select: { id: true } },
                disputes: { select: { id: true } },
                ledgerEntries: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    const auditedFreelanceContracts = await Promise.all(otherFreelanceContracts.map(async (contract) => ({
      ...contract,
      unescrowedFundingPayments: contract.freelanceDetails?.escrow
        ? []
        : await findContractFundingPayments(transaction, contract.id),
      safelyCancelled: await isSafelyCancelledContract(transaction, contract),
    })));
    const blockingContract = auditedFreelanceContracts.find((contract) => {
      const {
        disputes = [],
        ledgerEntries = [],
        freelanceDetails,
        unescrowedFundingPayments,
        safelyCancelled,
      } = contract;
      const escrow = freelanceDetails?.escrow;
      const payments = escrow?.payments ?? [];
      const hasFinancialActivity = payments.length > 0
        || unescrowedFundingPayments.length > 0
        || disputes.length > 0
        || ledgerEntries.length > 0
        || (escrow && (
          new Prisma.Decimal(escrow.fundedAmount ?? 0).gt(0)
          || new Prisma.Decimal(escrow.releasedAmount ?? 0).gt(0)
          || new Prisma.Decimal(escrow.refundedAmount ?? 0).gt(0)
          || Boolean(escrow.fundedAt || escrow.releasedAt)
          || (escrow.refunds ?? []).length > 0
          || (escrow.disputes ?? []).length > 0
          || (escrow.ledgerEntries ?? []).length > 0
        ));
      return !safelyCancelled || hasFinancialActivity;
    });
    if (blockingContract) {
      const escrow = blockingContract.freelanceDetails?.escrow;
      const statuses = [
        ...(escrow?.payments?.map(({ status: paymentStatus }) => paymentStatus) ?? []),
        ...(blockingContract.unescrowedFundingPayments?.map(({ status: paymentStatus }) => paymentStatus) ?? []),
      ];
      const hasInFlightPayment = statuses.some((paymentStatus) => ['PENDING', 'PROCESSING'].includes(paymentStatus));
      if (statuses.length > 0) {
        throw new ContractJobSelectionError(
          hasInFlightPayment
            ? 'Another candidate has a freelance payment pending or under verification. Resolve that payment state before selecting a replacement.'
            : 'Another candidate has a freelance payment attempt on record. Resolve its provider state before selecting a replacement.',
          hasInFlightPayment ? 'FREELANCE_SELECTION_PAYMENT_PENDING' : 'FREELANCE_SELECTION_PAYMENT_ATTEMPT',
        );
      }
      if (['FUNDED', 'RELEASE_ELIGIBLE', 'DISPUTED', 'RELEASED', 'REFUND_PENDING', 'REFUNDED'].includes(escrow?.status)
        || (escrow?.fundedAmount && new Prisma.Decimal(escrow.fundedAmount).gt(0))
        || statuses.some((paymentStatus) => ['SUCCESSFUL', 'REFUNDED'].includes(paymentStatus))) {
        throw new ContractJobSelectionError(
          'Another candidate has a funded freelance contract. Follow its existing financial workflow before selecting a replacement.',
          'FREELANCE_SELECTION_FUNDED_CONTRACT',
        );
      }
      throw new ContractJobSelectionError(
        'Another candidate is already selected for this project. Cancel the existing unfunded contract before selecting a replacement.',
        'FREELANCE_SELECTION_UNFUNDED_CONTRACT',
      );
    }

    const agreedAmount = new Prisma.Decimal(application.job.freelanceCompensation.projectAmount);
    const currency = application.job.freelanceCompensation.currency;
    const platformFeePercentage = await getActivePlatformFeePercentage(transaction);
    const platformFeeAmount = agreedAmount.mul(platformFeePercentage).dividedBy(100).toDecimalPlaces(2);
    const seekerNetAmount = agreedAmount;

    const contract = await transaction.contract.create({
      data: {
        applicationId: application.id,
        jobId: application.job.id,
        employerId: application.job.employerId,
        seekerId: application.seeker.id,
        type: 'FREELANCE_PROJECT',
        status: 'PENDING',
        freelanceDetails: {
          create: {
            agreedAmount,
            currency,
            platformFeePercentage,
            platformFeeAmount,
            seekerNetAmount,
            employerConfirmedAt: null,
            seekerConfirmedAt: null,
            workStatus: 'PENDING',
          },
        },
      },
      select: { id: true },
    });

    await transaction.escrow.create({
      data: {
        freelanceContractId: contract.id,
        grossAmount: agreedAmount,
        platformFeeAmount,
        seekerNetAmount,
        currency,
        status: 'UNFUNDED',
      },
      select: { id: true, status: true },
    });

    const updated = await transaction.application.update({
      where: { id: application.id },
      data: { status: 'ACCEPTED' },
      select: detailSelect,
    });

    return mapApplicationDetailWithSubscription(updated);
  }).catch(async (error) => {
    if (error?.code !== 'P2002') throw error;

    const existing = await findOwnedApplication(employerId, jobId, applicationId, detailSelect);
    if (!existing?.contract) throw error;
    return mapApplicationDetailWithSubscription(existing);
  });
};

export const selectContractJobApplication = async (employerId, jobId, applicationId) => {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Job"
      WHERE "id" = ${jobId}
      FOR UPDATE
    `;

    await transaction.$queryRaw`
      SELECT "id"
      FROM "Application"
      WHERE "id" = ${applicationId}
      FOR UPDATE
    `;

    const application = await transaction.application.findFirst({
      where: ownedApplicationWhere(employerId, jobId, applicationId),
      select: {
        id: true,
        seekerId: true,
        status: true,
        contract: { select: { id: true } },
        job: {
          select: {
            id: true,
            employerId: true,
            status: true,
            jobType: true,
            engagementType: true,
            contractCompensation: { select: { amount: true, currency: true, duration: true, startMode: true, scheduledStartDate: true, expectedCompletionDate: true } },
          },
        },
      },
    });

    if (!application) throw new EmployerApplicationNotFoundError();
    if (application.job.status !== 'APPROVED') throw new ContractJobSelectionError('The job must be approved before selecting an applicant');
    if (application.job.jobType !== 'NORMAL_EMPLOYMENT' || application.job.engagementType !== 'CONTRACT') {
      throw new ContractJobSelectionError('This selection flow is only for Contract Jobs');
    }
    if (!application.job.contractCompensation) throw new ContractJobSelectionError('Contract compensation is unavailable for this job');
    const existingContracts = await transaction.contract.findMany({
      where: {
        jobId: application.job.id,
        type: 'CONTRACT_PROJECT',
        applicationId: { not: application.id },
      },
      select: {
        id: true,
        jobId: true,
        seekerId: true,
        applicationId: true,
        employerId: true,
        status: true,
        cancelledAt: true,
        application: { select: { id: true, jobId: true, seekerId: true, status: true } },
        job: { select: { id: true, employerId: true } },
        disputes: { select: { id: true } },
        ledgerEntries: { select: { id: true } },
        freelanceDetails: {
          select: {
            contractId: true,
            workStatus: true,
            escrow: {
              select: {
                id: true,
                freelanceContractId: true,
                status: true,
                fundedAmount: true,
                releasedAmount: true,
                refundedAmount: true,
                fundedAt: true,
                releasedAt: true,
                cancelledAt: true,
                releaseEligibleAt: true,
                refunds: { select: { id: true } },
                disputes: { select: { id: true } },
                ledgerEntries: { select: { id: true } },
                payments: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    });
    const safelyCancelledContracts = await Promise.all(
      existingContracts.map((contract) => isSafelyCancelledContract(transaction, contract)),
    );
    if (safelyCancelledContracts.some((safelyCancelled) => !safelyCancelled)) {
      throw new ContractJobSelectionError('Another candidate has already been selected for this job.');
    }
    if (application.contract) throw new ContractJobSelectionError('This application already has an engagement');
    if (!['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW', 'PAYMENT_PENDING'].includes(application.status)) {
      throw new ContractJobSelectionError('This application is not eligible for selection');
    }

    await createNotification({
      recipientUserId: application.seekerId,
      actorUserId: employerId,
      type: 'INFO',
      category: 'APPLICATION',
      eventKey: `application:selected:${application.id}`,
      title: 'You were selected for a contract role',
      message: 'Your application has moved to the contract selection flow.',
      link: `/seeker/applications`,
    }, transaction).catch(() => undefined);

    const compensation = application.job.contractCompensation;
    const agreedAmount = new Prisma.Decimal(compensation.amount);
    const platformFeePercentage = await getActivePlatformFeePercentage(transaction);
    const platformFeeAmount = agreedAmount.mul(platformFeePercentage).dividedBy(100).toDecimalPlaces(2);
    const seekerNetAmount = agreedAmount;
    const selectedAt = new Date();
    const contract = await transaction.contract.create({
      data: {
        applicationId: application.id,
        jobId: application.job.id,
        employerId: application.job.employerId,
        seekerId: application.seekerId,
        type: 'CONTRACT_PROJECT',
        status: 'PENDING',
        startDate: compensation.startMode === 'IMMEDIATE' ? selectedAt : compensation.scheduledStartDate,
        expectedEndDate: compensation.expectedCompletionDate,
        freelanceDetails: {
          create: {
            agreedAmount,
            currency: compensation.currency,
            duration: compensation.duration,
            startMode: compensation.startMode,
            platformFeePercentage,
            platformFeeAmount,
            seekerNetAmount,
            expectedCompletionDate: compensation.expectedCompletionDate,
            workStatus: 'PENDING',
          },
        },
      },
      select: { id: true },
    });

    await transaction.escrow.create({
      data: {
        freelanceContractId: contract.id,
        grossAmount: agreedAmount,
        platformFeeAmount,
        seekerNetAmount,
        currency: compensation.currency,
        status: 'UNFUNDED',
      },
      select: { id: true, status: true },
    });

    await transaction.application.update({
      where: { id: application.id },
      data: { status: 'PAYMENT_PENDING' },
    });

    return { contractId: contract.id, applicationId: application.id, status: 'PAYMENT_PENDING' };
  }).catch(async (error) => {
    if (error?.code !== 'P2002') throw error;
    throw new ContractJobSelectionError('This application has already been selected');
  });
};

export const getEmployerApplicationResume = async (employerId, jobId, applicationId) => {
  const application = await findOwnedApplication(employerId, jobId, applicationId, {
    id: true,
    resumeObjectKey: true,
    seeker: { select: { seekerProfile: { select: { resumeObjectKey: true } } } },
  });

  const objectKey = application?.resumeObjectKey ?? application?.seeker?.seekerProfile?.resumeObjectKey;
  if (!application || !objectKey) {
    throw new EmployerApplicationResumeUnavailableError();
  }

  return {
    buffer: await readObject(objectKey),
    objectKey,
  };
};
