import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

export class AccountAnonymizationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.publicCode = code;
    this.publicMessage = message;
  }
}

export const anonymizeAdminManagedAccount = async (userId, adminId) => prisma.$transaction(async (transaction) => {
  if (userId === adminId) {
    throw new AccountAnonymizationError(403, 'SELF_ANONYMIZATION_FORBIDDEN', 'You cannot anonymize your own admin account.');
  }

  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isActive: true, anonymizedAt: true },
  });

  if (!user) {
    throw new AccountAnonymizationError(404, 'ACCOUNT_NOT_FOUND', 'The account could not be found.');
  }

  if (user.role === 'ADMIN') {
    throw new AccountAnonymizationError(403, 'ADMIN_ACCOUNT_PROTECTED', 'Admin accounts cannot be anonymized here.');
  }

  if (user.role !== 'SEEKER' && user.role !== 'EMPLOYER') {
    throw new AccountAnonymizationError(403, 'ACCOUNT_ROLE_NOT_ALLOWED', 'Only seeker and employer accounts can be anonymized.');
  }

  if (user.anonymizedAt) {
    throw new AccountAnonymizationError(409, 'ACCOUNT_ALREADY_ANONYMIZED', 'This account has already been anonymized.');
  }

  const anonymizedAt = new Date();
  const deactivated = await transaction.user.updateMany({
    where: { id: user.id, anonymizedAt: null },
    data: {
      email: `deleted-${user.id}@account.invalid`,
      firstName: 'Deleted',
      lastName: 'Account',
      phone: null,
      isActive: false,
      isVerified: false,
      anonymizedAt,
      lastLogin: null,
      marketingEmailsEnabled: false,
    },
  });

  if (deactivated.count !== 1) {
    throw new AccountAnonymizationError(409, 'ACCOUNT_ALREADY_ANONYMIZED', 'This account has already been deactivated or anonymized.');
  }

  if (user.role === 'SEEKER') {
    await transaction.seekerProfile.updateMany({
      where: { userId: user.id },
      data: {
        professionalTitle: null,
        bio: null,
        country: null,
        state: null,
        city: null,
        location: null,
        skills: [],
        education: Prisma.DbNull,
        experience: Prisma.DbNull,
        certifications: Prisma.DbNull,
        languages: Prisma.DbNull,
        projects: Prisma.DbNull,
        cvTemplate: null,
        linkedinUrl: null,
        website: null,
        resumeUrl: null,
        resumeObjectKey: null,
        profilePictureUrl: null,
        profilePictureKey: null,
        availability: 'NOT_AVAILABLE',
      },
    });
    await transaction.jobAlert.updateMany({
      where: { seekerId: user.id, isActive: true },
      data: { isActive: false },
    });
  } else {
    await transaction.employerProfile.updateMany({
      where: { userId: user.id },
      data: {
        companyName: 'Deleted account',
        companyDescription: null,
        website: null,
        industry: null,
        companySize: null,
        location: null,
        address: null,
        state: null,
        country: null,
        linkedinUrl: null,
        twitterUrl: null,
        facebookUrl: null,
        companyLogoUrl: null,
        companyLogoKey: null,
      },
    });
    await transaction.job.updateMany({
      where: { employerId: user.id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'CLOSED', closedAt: anonymizedAt },
    });
  }

  await Promise.all([
    transaction.emailVerificationCode.deleteMany({ where: { userId: user.id } }),
    transaction.oAuthAccount.deleteMany({ where: { userId: user.id } }),
    transaction.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    transaction.pendingOAuthRegistration.deleteMany({
      where: { OR: [{ userId: user.id }, { email: user.email }] },
    }),
  ]);

  return {
    userId: user.id,
    role: user.role,
    anonymized: true,
    isActive: false,
    anonymizedAt,
    retainedHistory: ['contracts', 'payments', 'financial ledger entries', 'audit records', 'other business records'],
  };
});
