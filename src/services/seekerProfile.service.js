import { prisma } from '../config/database.js';
import { randomUUID } from 'node:crypto';
import { createObjectKey, deleteObject, readObject, uploadObject } from './storage/storage.service.js';

const profileSelect = {
  id: true,
  userId: true,
  country: true,
  state: true,
  city: true,
  professionalTitle: true,
  location: true,
  skills: true,
  bio: true,
  education: true,
  experience: true,
  certifications: true,
  languages: true,
  projects: true,
  cvTemplate: true,
  linkedinUrl: true,
  resumeUrl: true,
  resumeObjectKey: true,
  profilePictureUrl: true,
  profilePictureKey: true,
  createdAt: true,
  updatedAt: true,
};

const normalizeSkills = (skills = []) => {
  if (!Array.isArray(skills)) return [];

  const uniqueSkills = [...new Set(skills.map((skill) => String(skill).trim()).filter(Boolean))];
  return uniqueSkills;
};

const normalizeLanguages = (languages = []) => {
  if (!Array.isArray(languages)) return [];

  const seen = new Set();
  return languages.reduce((normalized, language) => {
    const name = String(language.name ?? '').trim();
    const proficiency = String(language.proficiency ?? '').trim();
    const key = name.toLocaleLowerCase();

    if (!name || seen.has(key)) return normalized;

    seen.add(key);
    normalized.push({ id: String(language.id ?? '').trim() || randomUUID(), name, proficiency });
    return normalized;
  }, []);
};

const normalizeProjects = (projects = []) => {
  if (!Array.isArray(projects)) return [];

  return projects.map((project) => {
    const seenTechnologies = new Set();
    const technologies = (Array.isArray(project.technologies) ? project.technologies : [])
      .map((technology) => String(technology).trim())
      .filter((technology) => {
        const key = technology.toLocaleLowerCase();
        if (!technology || seenTechnologies.has(key)) return false;
        seenTechnologies.add(key);
        return true;
      });

    return {
      id: String(project.id ?? '').trim() || randomUUID(),
      name: String(project.name ?? '').trim(),
      description: String(project.description ?? '').trim(),
      technologies,
      projectUrl: String(project.projectUrl ?? '').trim(),
      githubUrl: String(project.githubUrl ?? '').trim(),
      startDate: String(project.startDate ?? '').trim(),
      endDate: String(project.endDate ?? '').trim(),
    };
  });
};

const formatLocation = ({ city, state, country }) => {
  const parts = [city, state, country].map((value) => String(value ?? '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
};

const splitFullName = (fullName) => {
  const name = String(fullName ?? '').trim();

  if (!name) {
    return { firstName: '', lastName: '' };
  }

  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
};

const calculateOnboardingComplete = (profile) => {
  if (!profile) {
    return false;
  }

  const requiredValues = [profile.country, profile.state, profile.city, profile.professionalTitle];
  const hasRequiredValues = requiredValues.every((value) => String(value ?? '').trim().length > 0);
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const hasSkills = skills.some((skill) => String(skill ?? '').trim().length > 0);

  return hasRequiredValues && hasSkills;
};

export const getSeekerProfileForUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      seekerProfile: { select: profileSelect },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const profile = user.seekerProfile ?? null;
  const normalizedProfile = profile ? {
    id: profile.id,
    country: profile.country,
    state: profile.state,
    city: profile.city,
    professionalTitle: profile.professionalTitle,
    location: profile.location,
    skills: profile.skills ?? [],
    bio: profile.bio ?? null,
    education: profile.education ?? null,
    experience: profile.experience ?? null,
    certifications: profile.certifications ?? null,
    languages: profile.languages ?? null,
    projects: profile.projects ?? null,
    cvTemplate: profile.cvTemplate ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    resumeUrl: profile.resumeUrl ?? null,
    resumeObjectKey: profile.resumeObjectKey ?? null,
    profilePictureUrl: profile.profilePictureUrl ?? null,
    profilePictureKey: profile.profilePictureKey ?? null,
  } : {
    id: null,
    country: null,
    state: null,
    city: null,
    professionalTitle: null,
    location: null,
    skills: [],
    bio: null,
    education: null,
    experience: null,
    certifications: null,
    languages: null,
    projects: null,
    cvTemplate: null,
    linkedinUrl: null,
    resumeUrl: null,
    resumeObjectKey: null,
    profilePictureUrl: null,
    profilePictureKey: null,
  };

  return {
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
    },
    profile: normalizedProfile,
    onboardingComplete: calculateOnboardingComplete(normalizedProfile),
  };
};

export const upsertSeekerProfileForUser = async (userId, payload) => {
  const hasExplicitNameParts = payload.firstName !== undefined || payload.lastName !== undefined;
  const hasFullName = payload.fullName !== undefined;

  if (hasFullName || hasExplicitNameParts) {
    const fullNameInput = hasFullName
      ? payload.fullName
      : `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim();

    const { firstName, lastName } = splitFullName(fullNameInput);

    await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: payload.firstName !== undefined ? payload.firstName.trim() || null : firstName || undefined,
        lastName: payload.lastName !== undefined ? payload.lastName.trim() || null : lastName || undefined,
      },
    });
  }

  const normalizedPayload = {
    country: payload.country?.trim() || null,
    state: payload.state?.trim() || null,
    city: payload.city?.trim() || null,
    professionalTitle: payload.professionalTitle?.trim() || null,
    skills: normalizeSkills(payload.skills),
  };

  const location = formatLocation(normalizedPayload);

  const profile = await prisma.seekerProfile.upsert({
    where: { userId },
    update: {
      ...normalizedPayload,
      location,
      updatedAt: new Date(),
    },
    create: {
      userId,
      ...normalizedPayload,
      location,
    },
    select: profileSelect,
  });

  return {
    id: profile.id,
    country: profile.country,
    state: profile.state,
    city: profile.city,
    professionalTitle: profile.professionalTitle,
    location: profile.location,
    skills: profile.skills ?? [],
    bio: profile.bio ?? null,
    education: profile.education ?? null,
    experience: profile.experience ?? null,
    certifications: profile.certifications ?? null,
    languages: profile.languages ?? null,
    projects: profile.projects ?? null,
    cvTemplate: profile.cvTemplate ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    resumeUrl: profile.resumeUrl ?? null,
    resumeObjectKey: profile.resumeObjectKey ?? null,
    profilePictureUrl: profile.profilePictureUrl ?? null,
    profilePictureKey: profile.profilePictureKey ?? null,
  };
};

export const updateSeekerCVForUser = async (userId, payload) => {
  const normalizedPayload = {};

  if (payload.bio !== undefined) {
    normalizedPayload.bio = payload.bio ? payload.bio.trim() || null : null;
  }

  if (payload.education !== undefined) {
    normalizedPayload.education = payload.education ?? null;
  }

  if (payload.experience !== undefined) {
    normalizedPayload.experience = payload.experience ?? null;
  }

  if (payload.certifications !== undefined) {
    normalizedPayload.certifications = payload.certifications ?? null;
  }

  if (payload.languages !== undefined) {
    normalizedPayload.languages = payload.languages === null ? null : normalizeLanguages(payload.languages);
  }

  if (payload.projects !== undefined) {
    normalizedPayload.projects = payload.projects === null ? null : normalizeProjects(payload.projects);
  }

  if (payload.linkedinUrl !== undefined) {
    normalizedPayload.linkedinUrl = payload.linkedinUrl ? payload.linkedinUrl.trim() || null : null;
  }

  if (payload.cvTemplate !== undefined) {
    normalizedPayload.cvTemplate = payload.cvTemplate ?? null;
  }

  const profile = await prisma.seekerProfile.upsert({
    where: { userId },
    update: {
      ...normalizedPayload,
      updatedAt: new Date(),
    },
    create: {
      userId,
      ...normalizedPayload,
    },
    select: profileSelect,
  });

  return {
    id: profile.id,
    bio: profile.bio ?? null,
    education: profile.education ?? null,
    experience: profile.experience ?? null,
    certifications: profile.certifications ?? null,
    languages: profile.languages ?? null,
    projects: profile.projects ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    cvTemplate: profile.cvTemplate ?? null,
  };
};

const fileProfileSelect = {
  id: true,
  profilePictureUrl: true,
  profilePictureKey: true,
  resumeUrl: true,
  resumeObjectKey: true,
};

const updateStoredFile = async ({ userId, category, extension, file, urlField, keyField }) => {
  const current = await prisma.seekerProfile.findUnique({
    where: { userId },
    select: fileProfileSelect,
  });
  const objectKey = createObjectKey({ userId, category, extension });

  await uploadObject({ objectKey, buffer: file.buffer });

  try {
    const profile = await prisma.seekerProfile.upsert({
      where: { userId },
      update: { [urlField]: `/api/seeker/profile/${category}`, [keyField]: objectKey, updatedAt: new Date() },
      create: { userId, [urlField]: `/api/seeker/profile/${category}`, [keyField]: objectKey },
      select: fileProfileSelect,
    });

    await deleteObject(current?.[keyField]);
    return profile;
  } catch (error) {
    await deleteObject(objectKey);
    throw error;
  }
};

export const updateSeekerProfilePictureForUser = (userId, file, extension) =>
  updateStoredFile({
    userId,
    category: 'picture',
    extension,
    file,
    urlField: 'profilePictureUrl',
    keyField: 'profilePictureKey',
  });

export const updateSeekerResumeForUser = (userId, file, extension) =>
  updateStoredFile({
    userId,
    category: 'resume',
    extension,
    file,
    urlField: 'resumeUrl',
    keyField: 'resumeObjectKey',
  });

const deleteStoredFile = async ({ userId, urlField, keyField }) => {
  const profile = await prisma.seekerProfile.findUnique({
    where: { userId },
    select: fileProfileSelect,
  });

  if (!profile?.[keyField]) return null;

  await prisma.seekerProfile.update({
    where: { userId },
    data: { [urlField]: null, [keyField]: null, updatedAt: new Date() },
    select: fileProfileSelect,
  });
  await deleteObject(profile[keyField]);
  return { [urlField]: null, [keyField]: null };
};

export const deleteSeekerProfilePictureForUser = (userId) =>
  deleteStoredFile({ userId, urlField: 'profilePictureUrl', keyField: 'profilePictureKey' });

export const deleteSeekerResumeForUser = (userId) =>
  deleteStoredFile({ userId, urlField: 'resumeUrl', keyField: 'resumeObjectKey' });

export const readSeekerFileForUser = async (userId, keyField) => {
  const profile = await prisma.seekerProfile.findUnique({
    where: { userId },
    select: fileProfileSelect,
  });
  const objectKey = profile?.[keyField];
  if (!objectKey) return null;
  return { buffer: await readObject(objectKey), objectKey };
};
