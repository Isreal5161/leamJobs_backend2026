import { prisma } from '../config/database.js';
import { createNotification } from './notification.service.js';
import { createObjectKey, deleteObject, readObject, uploadObject } from './storage/storage.service.js';

const verificationDocumentSelect = {
  id: true,
  kind: true,
  fileName: true,
  contentType: true,
  fileSize: true,
  objectKey: true,
  uploadedAt: true,
};

const verificationSelect = {
  id: true,
  userId: true,
  status: true,
  submittedAt: true,
  reviewedById: true,
  reviewedAt: true,
  declineReason: true,
  registrationNumber: true,
  registrationType: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      employerProfile: {
        select: {
          companyName: true,
          companyDescription: true,
          website: true,
          industry: true,
          companySize: true,
          location: true,
          address: true,
          state: true,
          country: true,
          linkedinUrl: true,
          twitterUrl: true,
          facebookUrl: true,
          companyLogoUrl: true,
        },
      },
    },
  },
  documents: { select: verificationDocumentSelect },
};

const normalizeKind = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  const allowedKinds = ['CAC', 'TRADE_LICENSE', 'TAX_CERTIFICATE', 'UTILITY_BILL', 'IDENTITY_SUPPORTING', 'OTHER'];
  if (!allowedKinds.includes(normalized)) {
    const error = new Error('A valid verification document type is required');
    error.status = 400;
    throw error;
  }
  return normalized;
};

const allowedDocumentMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const validateVerificationDocumentFile = (file) => {
  if (!file) {
    const error = new Error('A document file is required');
    error.status = 400;
    throw error;
  }

  if (file.size > 10 * 1024 * 1024) {
    const error = new Error('Verification documents must be 10 MB or smaller');
    error.status = 413;
    throw error;
  }

  if (!file.buffer?.length) {
    const error = new Error('The uploaded document is empty');
    error.status = 400;
    throw error;
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  if (!allowedDocumentMimeTypes.has(mimeType)) {
    const error = new Error('Unsupported document type. Please upload a PDF, JPG, PNG, or WEBP image.');
    error.status = 415;
    throw error;
  }

  const originalName = String(file.originalname || '').trim();
  if (!originalName || originalName.length > 255 || /[<>:"/\\|?*]/.test(originalName)) {
    const error = new Error('The uploaded file name is invalid');
    error.status = 400;
    throw error;
  }
};

const mapVerification = (verification) => ({
  id: verification.id,
  userId: verification.userId,
  status: verification.status,
  submittedAt: verification.submittedAt,
  reviewedAt: verification.reviewedAt,
  reviewedById: verification.reviewedById,
  declineReason: verification.declineReason ?? null,
  registrationNumber: verification.registrationNumber ?? null,
  registrationType: verification.registrationType ?? null,
  employer: verification.user ? {
    id: verification.user.id,
    email: verification.user.email,
    phone: verification.user.phone,
    firstName: verification.user.firstName,
    lastName: verification.user.lastName,
    company: verification.user.employerProfile ? {
      companyName: verification.user.employerProfile.companyName,
      companyDescription: verification.user.employerProfile.companyDescription,
      website: verification.user.employerProfile.website,
      industry: verification.user.employerProfile.industry,
      companySize: verification.user.employerProfile.companySize,
      location: verification.user.employerProfile.location,
      address: verification.user.employerProfile.address,
      state: verification.user.employerProfile.state,
      country: verification.user.employerProfile.country,
      linkedinUrl: verification.user.employerProfile.linkedinUrl,
      twitterUrl: verification.user.employerProfile.twitterUrl,
      facebookUrl: verification.user.employerProfile.facebookUrl,
      companyLogoUrl: verification.user.employerProfile.companyLogoUrl,
    } : null,
  } : null,
  documents: (verification.documents ?? []).map((document) => ({
    id: document.id,
    kind: document.kind,
    fileName: document.fileName,
    contentType: document.contentType,
    fileSize: document.fileSize ?? null,
    uploadedAt: document.uploadedAt,
  })),
  createdAt: verification.createdAt,
  updatedAt: verification.updatedAt,
});

const ensureVerificationRecord = async (employerId) => {
  const existing = await prisma.employerVerification.findUnique({
    where: { userId: employerId },
    select: { id: true, status: true, userId: true },
  });

  if (existing) {
    return existing;
  }

  try {
    return await prisma.employerVerification.create({
      data: {
        userId: employerId,
        status: 'PENDING',
        submittedAt: null,
      },
      select: { id: true, userId: true, status: true, submittedAt: true },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return prisma.employerVerification.findUnique({
      where: { userId: employerId },
      select: { id: true, userId: true, status: true, submittedAt: true },
    });
  }
};

class VerificationStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerificationStateError';
    this.status = 409;
    this.publicCode = 'VERIFICATION_STATE_CONFLICT';
  }
}

const loadVerificationById = (verificationId) => prisma.employerVerification.findUnique({
  where: { id: verificationId },
  select: verificationSelect,
});

const assertReviewableVerification = (verification) => {
  if (verification.status === 'APPROVED') throw new VerificationStateError('Your company is already verified.');
  if (verification.status === 'REJECTED') throw new VerificationStateError('This verification must be resubmitted before it can be reviewed again.');
  if (!verification.submittedAt) throw new VerificationStateError('This verification has not been submitted for review.');
};

export const getEmployerVerification = async (employerId) => {
  const verification = await prisma.employerVerification.findUnique({
    where: { userId: employerId },
    select: verificationSelect,
  });

  if (!verification) {
    return { verification: { status: 'PENDING', submittedAt: null, reviewedAt: null, declineReason: null, documents: [] } };
  }

  return { verification: mapVerification(verification) };
};

export const submitEmployerVerification = async (employerId, { registrationNumber, registrationType = 'CAC' } = {}) => {
  const normalizedRegistrationNumber = String(registrationNumber ?? '').trim();
  const normalizedRegistrationType = String(registrationType ?? '').trim().toUpperCase();
  if (!normalizedRegistrationNumber) {
    const error = new Error('CAC, BN, or business registration number is required');
    error.status = 400;
    throw error;
  }
  if (!['CAC', 'BN', 'OTHER'].includes(normalizedRegistrationType)) {
    const error = new Error('A valid registration type is required');
    error.status = 400;
    throw error;
  }

  const employer = await prisma.user.findUnique({
    where: { id: employerId },
    select: { employerProfile: { select: { companyName: true } } },
  });
  if (!employer?.employerProfile?.companyName?.trim()) {
    const error = new Error('Complete your company profile before submitting verification');
    error.status = 400;
    throw error;
  }

  let verification = await prisma.employerVerification.findUnique({
    where: { userId: employerId },
    select: { id: true, userId: true, status: true, submittedAt: true },
  });
  const submittedAt = new Date();
  let created = false;

  if (!verification) {
    try {
      verification = await prisma.employerVerification.create({
        data: {
          userId: employerId,
          status: 'PENDING',
          submittedAt,
          registrationNumber: normalizedRegistrationNumber,
          registrationType: normalizedRegistrationType,
        },
        select: { id: true, userId: true, status: true, submittedAt: true },
      });
      created = true;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      verification = await prisma.employerVerification.findUnique({
        where: { userId: employerId },
        select: { id: true, userId: true, status: true, submittedAt: true },
      });
    }
  }

  if (!verification) throw new Error('Verification could not be loaded');
  if (!created && verification.status === 'APPROVED') throw new VerificationStateError('Your company is already verified.');
  if (!created && verification.status === 'PENDING' && verification.submittedAt) throw new VerificationStateError('Your company verification is already under review.');

  if (!created && (verification.status === 'REJECTED' || (verification.status === 'PENDING' && !verification.submittedAt))) {
    const result = await prisma.employerVerification.updateMany({
      where: {
        id: verification.id,
        ...(verification.status === 'REJECTED' ? { status: 'REJECTED' } : { status: 'PENDING', submittedAt: null }),
      },
      data: {
        status: 'PENDING',
        submittedAt,
        registrationNumber: normalizedRegistrationNumber,
        registrationType: normalizedRegistrationType,
      },
    });
    if (result.count !== 1) throw new VerificationStateError('Your verification changed while it was being submitted. Please review the current status and try again.');
  }

  return getEmployerVerification(employerId);
};

export const listEmployerVerifications = async () => {
  const rows = await prisma.employerVerification.findMany({
    where: { submittedAt: { not: null } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      declineReason: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          employerProfile: {
            select: {
              companyName: true,
              companyDescription: true,
              website: true,
              industry: true,
              companySize: true,
              location: true,
              address: true,
              state: true,
              country: true,
              linkedinUrl: true,
              twitterUrl: true,
              facebookUrl: true,
            },
          },
        },
      },
      documents: { select: { id: true, kind: true, fileName: true } },
    },
  });

  return {
    verificationSubmissions: rows.map((row) => ({
      id: row.id,
      status: row.status,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      declineReason: row.declineReason ?? null,
      employer: row.user ? {
        id: row.user.id,
        email: row.user.email,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        companyName: row.user.employerProfile?.companyName ?? null,
        company: row.user.employerProfile ?? null,
      } : null,
      documentCount: row.documents.length,
    })),
  };
};

export const getEmployerVerificationForAdmin = async (verificationId) => {
  const verification = await prisma.employerVerification.findUnique({
    where: { id: verificationId },
    select: verificationSelect,
  });

  if (!verification) {
    const error = new Error('Verification request not found');
    error.status = 404;
    throw error;
  }

  return { verification: mapVerification(verification) };
};

export const approveEmployerVerification = async (adminId, verificationId) => {
  const verification = await prisma.employerVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, userId: true, status: true, submittedAt: true, user: { select: { email: true, firstName: true, lastName: true } } },
  });

  if (!verification) {
    const error = new Error('Verification request not found');
    error.status = 404;
    throw error;
  }

  assertReviewableVerification(verification);
  const updateResult = await prisma.employerVerification.updateMany({
    where: { id: verificationId, status: 'PENDING', submittedAt: { not: null } },
    data: {
      status: 'APPROVED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      declineReason: null,
    },
  });
  if (updateResult.count !== 1) throw new VerificationStateError('This verification was already reviewed.');
  const updated = await loadVerificationById(verificationId);

  await createNotification({
    recipientUserId: verification.userId,
    recipientEmail: verification.user?.email,
    actorUserId: adminId,
    type: 'SUCCESS',
    category: 'VERIFICATION',
    eventKey: `employerVerification:approved:${verificationId}`,
    title: 'Company verification approved',
    message: `Your company verification has been approved. You can now post jobs on LeamJobs.`,
    link: '/employer/verification',
  }).catch(() => undefined);

  return { verification: mapVerification(updated) };
};

export const rejectEmployerVerification = async (adminId, verificationId, reason) => {
  const verification = await prisma.employerVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, userId: true, status: true, submittedAt: true, user: { select: { email: true, firstName: true, lastName: true } } },
  });

  if (!verification) {
    const error = new Error('Verification request not found');
    error.status = 404;
    throw error;
  }

  const trimmedReason = String(reason ?? '').trim();
  if (!trimmedReason) {
    const error = new Error('A decline reason is required');
    error.status = 400;
    throw error;
  }

  assertReviewableVerification(verification);
  const updateResult = await prisma.employerVerification.updateMany({
    where: { id: verificationId, status: 'PENDING', submittedAt: { not: null } },
    data: {
      status: 'REJECTED',
      reviewedById: adminId,
      reviewedAt: new Date(),
      declineReason: trimmedReason,
    },
  });
  if (updateResult.count !== 1) throw new VerificationStateError('This verification was already reviewed.');
  const updated = await loadVerificationById(verificationId);

  await createNotification({
    recipientUserId: verification.userId,
    recipientEmail: verification.user?.email,
    actorUserId: adminId,
    type: 'WARNING',
    category: 'VERIFICATION',
    eventKey: `employerVerification:declined:${verificationId}`,
    title: 'Company verification needs attention',
    message: `Your company verification was not approved. ${trimmedReason}`,
    link: '/employer/verification',
  }).catch(() => undefined);

  return { verification: mapVerification(updated) };
};

export const uploadVerificationDocument = async (employerId, file, kind) => {
  validateVerificationDocumentFile(file);

  const normalizedKind = normalizeKind(kind);
  const extension = file.originalname.split('.').pop()?.toLowerCase() ?? 'pdf';
  const safeExtension = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'pdf';
  const objectKey = createObjectKey({ userId: employerId, namespace: 'employers', category: normalizedKind.toLowerCase(), extension: safeExtension });

  await uploadObject({ objectKey, buffer: file.buffer });

  try {
    let verification = await prisma.employerVerification.findUnique({
      where: { userId: employerId },
      select: { id: true, status: true, submittedAt: true },
    });

    if (verification?.status === 'APPROVED') throw new VerificationStateError('Your company is already verified.');
    if (verification?.status === 'PENDING' && verification.submittedAt) throw new VerificationStateError('Your company verification is already under review.');
    if (!verification) verification = await ensureVerificationRecord(employerId);

    const document = await prisma.employerVerificationDocument.create({
      data: {
        verificationId: verification.id,
        kind: normalizedKind,
        fileName: file.originalname,
        contentType: file.mimetype,
        fileSize: file.buffer.length,
        objectKey,
      },
      select: verificationDocumentSelect,
    });

    return {
      document: {
        id: document.id,
        kind: document.kind,
        fileName: document.fileName,
        contentType: document.contentType,
        fileSize: document.fileSize ?? null,
        uploadedAt: document.uploadedAt,
      },
    };
  } catch (error) {
    await deleteObject(objectKey).catch(() => undefined);
    if (error?.code === 'P2002') throw new VerificationStateError('This verification document could not be saved because it was submitted more than once.');
    throw error;
  }
};

export const readVerificationDocumentForUser = async (employerId, documentId) => {
  const document = await prisma.employerVerificationDocument.findFirst({
    where: {
      id: documentId,
      verification: { userId: employerId },
    },
    select: {
      id: true,
      contentType: true,
      objectKey: true,
      fileName: true,
    },
  });

  if (!document) {
    const error = new Error('Verification document not found');
    error.status = 404;
    throw error;
  }

  const buffer = await readObject(document.objectKey);
  return {
    buffer,
    contentType: document.contentType,
    fileName: document.fileName,
    objectKey: document.objectKey,
  };
};

export const readVerificationDocumentForAdmin = async (documentId) => {
  const document = await prisma.employerVerificationDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      contentType: true,
      objectKey: true,
      fileName: true,
      kind: true,
      verification: {
        select: { id: true, userId: true },
      },
    },
  });

  if (!document) {
    const error = new Error('Verification document not found');
    error.status = 404;
    throw error;
  }

  const buffer = await readObject(document.objectKey);
  return {
    buffer,
    contentType: document.contentType,
    fileName: document.fileName,
    objectKey: document.objectKey,
    kind: document.kind,
    verificationId: document.verification.id,
    userId: document.verification.userId,
  };
};

export const deleteVerificationDocumentForUser = async (employerId, documentId) => {
  const document = await prisma.employerVerificationDocument.findFirst({
    where: {
      id: documentId,
      verification: { userId: employerId },
    },
    select: { id: true, objectKey: true, verification: { select: { status: true, submittedAt: true } } },
  });

  if (!document) {
    const error = new Error('Verification document not found');
    error.status = 404;
    throw error;
  }

  if (document.verification.status === 'APPROVED' || (document.verification.status === 'PENDING' && document.verification.submittedAt)) {
    throw new VerificationStateError('Documents cannot be changed while verification is being reviewed.');
  }

  await deleteObject(document.objectKey);
  await prisma.employerVerificationDocument.delete({ where: { id: documentId } });
  return { success: true };
};
