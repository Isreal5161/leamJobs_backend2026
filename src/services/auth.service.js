import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { queueWelcomeEmail } from './adminCommunications.service.js';
import { registerEmailVerificationOnUser } from './emailVerification.service.js';
import { initializeSeekerWallet } from './wallet.service.js';
import { assertCurrentLegalAcceptance, recordLegalAcceptance } from './legalAcceptance.service.js';
import { createAuthenticatedSession } from './authSession.service.js';

const BCRYPT_ROUNDS = 12;

export const getLegalAcceptanceStatus = async (userId) => {
  const [terms, privacy] = await Promise.all([
    prisma.userLegalAcceptance.findUnique({
      where: {
        userId_documentType_version: {
          userId,
          documentType: 'TERMS',
          version: env.TERMS_DOCUMENT_VERSION,
        },
      },
      select: { acceptedAt: true },
    }),
    prisma.userLegalAcceptance.findUnique({
      where: {
        userId_documentType_version: {
          userId,
          documentType: 'PRIVACY',
          version: env.PRIVACY_DOCUMENT_VERSION,
        },
      },
      select: { acceptedAt: true },
    }),
  ]);
  return {
    terms: { version: env.TERMS_DOCUMENT_VERSION, acceptedAt: terms?.acceptedAt ?? null },
    privacy: { version: env.PRIVACY_DOCUMENT_VERSION, acceptedAt: privacy?.acceptedAt ?? null },
  };
};

export const recordAccountLegalAcceptance = async (userId, versions) => {
  assertCurrentLegalAcceptance(versions);
  await prisma.$transaction((transaction) => recordLegalAcceptance(transaction, userId, versions, 'ACCOUNT'));
  return getLegalAcceptanceStatus(userId);
};

export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'DuplicateEmailError';
    this.status = 409;
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'AuthenticationError';
    this.status = 401;
  }
}

export class InactiveAccountError extends Error {
  constructor() {
    super('Your account is inactive');
    this.name = 'InactiveAccountError';
    this.status = 403;
  }
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthenticationRequiredError';
    this.status = 401;
  }
}

export class RoleMismatchError extends Error {
  constructor(expectedRole, actualRole) {
    const roleLabel = expectedRole === 'SEEKER' ? 'seeker' : 'employer';
    super(`You are not registered as ${roleLabel === 'employer' ? 'an' : 'a'} ${roleLabel}.`);
    this.name = 'RoleMismatchError';
    this.status = 403;
    this.publicCode = 'ROLE_MISMATCH';
    this.actualRole = actualRole;
    this.expectedRole = expectedRole;
  }
}

export class InvalidPublicRegistrationRoleError extends Error {
  constructor() {
    super('Public registration role must be SEEKER or EMPLOYER.');
    this.name = 'InvalidPublicRegistrationRoleError';
    this.status = 400;
    this.publicMessage = 'Role must be SEEKER or EMPLOYER.';
  }
}

const normalizePublicRegistrationRole = (role) => {
  const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : undefined;

  if (normalizedRole === 'SEEKER' || normalizedRole === 'EMPLOYER') {
    return normalizedRole;
  }

  throw new InvalidPublicRegistrationRoleError();
};

export const registerUser = async ({ firstName, lastName, email, password, phone, role, termsAccepted, privacyAccepted, acceptedTermsVersion, acceptedPrivacyVersion }) => {
  const legalVersions = { termsAccepted, privacyAccepted, acceptedTermsVersion, acceptedPrivacyVersion };
  assertCurrentLegalAcceptance(legalVersions);
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = normalizePublicRegistrationRole(role);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: {
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
          email: normalizedEmail,
          passwordHash,
          phone,
          role: normalizedRole,
          isActive: false,
          isVerified: false,
        },
      });

      if (normalizedRole === 'SEEKER') {
        await initializeSeekerWallet(transaction, createdUser.id);
      }

      await recordLegalAcceptance(transaction, createdUser.id, legalVersions, 'PASSWORD');
      return createdUser;
    });

    await registerEmailVerificationOnUser(user);
    void queueWelcomeEmail(user).catch((error) => console.error('Welcome email queue failed:', { message: error.message }));
    return user;
  } catch (error) {
    if (error?.code === 'P2002' && error.meta?.target?.includes('email')) {
      throw new DuplicateEmailError();
    }

    throw error;
  }
};

export const loginUser = async ({ email, password, role }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const candidate = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!candidate) {
    await bcrypt.hash(password, BCRYPT_ROUNDS);
    throw new AuthenticationError();
  }

  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR UPDATE`;

    const user = await transaction.user.findUnique({
      where: { id: candidate.id },
    });

    if (!user || user.email !== normalizedEmail || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AuthenticationError();
    }

    const legacyUserWithoutVerificationRecord = user.isActive && user.isVerified === false
      && !(await transaction.emailVerificationCode.findUnique({
        where: { userId: user.id },
        select: { id: true },
      }));

    if ((user.isVerified === false && !legacyUserWithoutVerificationRecord) || user.isActive === false) {
      throw new AuthenticationError();
    }

    if (role && user.role !== role) {
      throw new AuthenticationError();
    }

    const updatedUser = await transaction.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    const token = await createAuthenticatedSession(updatedUser, transaction);

    return { token, user: updatedUser };
  });

  return result;
};

export const getCurrentUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      isVerified: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  if (!user.isActive) {
    throw new InactiveAccountError();
  }

  return user;
};
