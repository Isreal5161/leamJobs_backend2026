import { prisma } from '../config/database.js';
import { AuthenticationRequiredError } from './auth.service.js';
import { createObjectKey, deleteObject, readObject, uploadObject } from './storage/storage.service.js';

const profileSelect = {
  id: true,
  companyName: true,
  companyDescription: true,
  website: true,
  industry: true,
  companySize: true,
  location: true,
  companyLogoUrl: true,
  companyLogoKey: true,
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

export const updateEmployerCompanyLogoForUser = async (employerId, file, extension) => {
  const current = await prisma.employerProfile.findUnique({
    where: { userId: employerId },
    select: { companyLogoKey: true },
  });
  if (!current) {
    const error = new Error('Create a company profile before uploading a logo');
    error.status = 400;
    throw error;
  }

  const objectKey = createObjectKey({ userId: employerId, namespace: 'employers', category: 'company-logo', extension });
  await uploadObject({ objectKey, buffer: file.buffer });

  try {
    const profile = await prisma.employerProfile.update({
      where: { userId: employerId },
      data: {
        companyLogoUrl: '/api/employer/profile/logo',
        companyLogoKey: objectKey,
        updatedAt: new Date(),
      },
      select: profileSelect,
    });
    await deleteObject(current.companyLogoKey);
    return mapProfile(profile);
  } catch (error) {
    await deleteObject(objectKey);
    throw error;
  }
};

export const deleteEmployerCompanyLogoForUser = async (employerId) => {
  const profile = await prisma.employerProfile.findUnique({
    where: { userId: employerId },
    select: { companyLogoKey: true },
  });
  if (!profile?.companyLogoKey) return { companyLogoUrl: null };

  await prisma.employerProfile.update({
    where: { userId: employerId },
    data: { companyLogoUrl: null, companyLogoKey: null, updatedAt: new Date() },
  });
  await deleteObject(profile.companyLogoKey);
  return { companyLogoUrl: null };
};

export const readEmployerCompanyLogoForUser = async (employerId) => {
  const profile = await prisma.employerProfile.findUnique({
    where: { userId: employerId },
    select: { companyLogoKey: true },
  });
  if (!profile?.companyLogoKey) return null;
  return { buffer: await readObject(profile.companyLogoKey), objectKey: profile.companyLogoKey };
};
