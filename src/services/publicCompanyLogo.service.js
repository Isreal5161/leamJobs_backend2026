import { prisma } from '../config/database.js';
import { readObject } from './storage/storage.service.js';

export class PublicCompanyLogoNotFoundError extends Error {
  constructor() {
    super('Company logo not found');
    this.name = 'PublicCompanyLogoNotFoundError';
    this.status = 404;
  }
}

export const readPublicCompanyLogo = async (employerId) => {
  const profile = await prisma.employerProfile.findUnique({
    where: { userId: employerId },
    select: { companyLogoKey: true },
  });

  if (!profile?.companyLogoKey) throw new PublicCompanyLogoNotFoundError();

  const extension = profile.companyLogoKey.split('.').pop()?.toLowerCase();
  const contentType = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }[extension];

  if (!contentType) throw new PublicCompanyLogoNotFoundError();

  return { buffer: await readObject(profile.companyLogoKey), contentType };
};
