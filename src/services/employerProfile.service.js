import { prisma } from '../config/database.js';
import { AuthenticationRequiredError } from './auth.service.js';

const profileSelect = {
  id: true,
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  companySize: true,
  location: true,
  companyLogoUrl: true,
};

const userSelect = {
  email: true,
  employerProfile: { select: profileSelect },
};

export class EmployerProfileRequiredError extends Error {
  constructor() {
    super('Company name is required to create an employer profile');
    this.name = 'EmployerProfileRequiredError';
    this.status = 400;
  }
}

const mapProfile = (profile) => profile ? {
  id: profile.id,
  companyName: profile.companyName,
  companyDescription: profile.companyDescription,
  website: profile.website,
  industry: profile.industry,
  companySize: profile.companySize,
  location: profile.location,
  companyLogoUrl: profile.companyLogoUrl,
} : null;

const mapResponse = (user, profile = user.employerProfile) => ({
  profile: mapProfile(profile),
  account: { email: user.email },
});

const getEmployerUser = (employerId) => prisma.user.findUnique({
  where: { id: employerId },
  select: userSelect,
});

export const getEmployerProfile = async (employerId) => {
  const user = await getEmployerUser(employerId);
  if (!user) throw new AuthenticationRequiredError();
  return mapResponse(user);
};

export const updateEmployerProfile = async (employerId, payload) => {
  const user = await getEmployerUser(employerId);
  if (!user) throw new AuthenticationRequiredError();
  if (!user.employerProfile && payload.companyName === undefined) {
    throw new EmployerProfileRequiredError();
  }

  const profileData = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

  const profile = await prisma.employerProfile.upsert({
    where: { userId: employerId },
    update: profileData,
    create: { userId: employerId, companyName: payload.companyName, ...profileData },
    select: profileSelect,
  });

  return mapResponse(user, profile);
};
