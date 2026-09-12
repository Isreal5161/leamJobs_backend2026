import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';

const LEAMJOBS_EMPLOYER_EMAIL = (process.env.LEAMJOBS_EMPLOYER_EMAIL || 'hiring@leamjobs.com').trim().toLowerCase();
const LEAMJOBS_COMPANY_NAME = 'LeamJobs';
const BCRYPT_ROUNDS = 12;

const getGeneratedEmployerPassword = () => {
  const configuredPassword = process.env.LEAMJOBS_EMPLOYER_PASSWORD?.trim();
  if (configuredPassword) {
    return configuredPassword;
  }

  return `leamjobs-${crypto.randomUUID().replace(/-/g, '')}`;
};

export const getLeamJobsEmployerEmail = () => LEAMJOBS_EMPLOYER_EMAIL;

export const getLeamJobsEmployerCompanyName = () => LEAMJOBS_COMPANY_NAME;

export const ensureLeamJobsEmployerIdentity = async () => {
  const loadCanonicalUser = async () => prisma.user.findUnique({
    where: { email: LEAMJOBS_EMPLOYER_EMAIL },
    select: {
      id: true,
      role: true,
      employerProfile: { select: { id: true, companyName: true } },
    },
  });

  const normalizeExistingUser = async (existing) => {
    if (existing.role !== 'EMPLOYER') {
      throw new Error('A non-employer account already exists for the canonical LeamJobs employer email.');
    }

    const profile = existing.employerProfile;

    if (!profile || profile.companyName !== LEAMJOBS_COMPANY_NAME) {
      const profileRecord = await prisma.employerProfile.upsert({
        where: { userId: existing.id },
        update: { companyName: LEAMJOBS_COMPANY_NAME },
        create: {
          userId: existing.id,
          companyName: LEAMJOBS_COMPANY_NAME,
        },
      });

      return {
        id: existing.id,
        email: LEAMJOBS_EMPLOYER_EMAIL,
        companyName: profileRecord.companyName,
        created: false,
      };
    }

    return {
      id: existing.id,
      email: LEAMJOBS_EMPLOYER_EMAIL,
      companyName: profile.companyName,
      created: false,
    };
  };

  const existing = await loadCanonicalUser();
  if (existing) {
    return normalizeExistingUser(existing);
  }

  const passwordHash = await bcrypt.hash(getGeneratedEmployerPassword(), BCRYPT_ROUNDS);

  try {
    const created = await prisma.user.create({
      data: {
        email: LEAMJOBS_EMPLOYER_EMAIL,
        passwordHash,
        firstName: 'LeamJobs',
        lastName: 'Team',
        role: 'EMPLOYER',
        isActive: true,
        isVerified: true,
        employerProfile: {
          create: {
            companyName: LEAMJOBS_COMPANY_NAME,
            companyDescription: 'LeamJobs internal employer identity',
            website: 'https://leamjobs.com',
            industry: 'Technology',
            location: 'Remote',
          },
        },
      },
      include: { employerProfile: true },
    });

    return {
      id: created.id,
      email: created.email,
      companyName: created.employerProfile?.companyName ?? LEAMJOBS_COMPANY_NAME,
      created: true,
    };
  } catch (error) {
    if (error?.code !== 'P2002') {
      throw error;
    }

    const recovered = await loadCanonicalUser();
    if (!recovered) {
      throw error;
    }

    return normalizeExistingUser(recovered);
  }
};

export const getLeamJobsEmployerIdentity = async () => {
  const result = await ensureLeamJobsEmployerIdentity();
  return {
    userId: result.id,
    email: result.email,
    companyName: result.companyName,
    created: result.created,
  };
};
