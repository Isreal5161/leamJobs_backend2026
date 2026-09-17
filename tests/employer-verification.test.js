import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const employerId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const verificationId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  employerProfile: { upsert: jest.fn() },
  $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  employerVerification: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  employerVerificationDocument: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

const createNotification = jest.fn().mockResolvedValue({ id: 'notification-1' });
const uploadObject = jest.fn().mockResolvedValue({ objectKey: `employers/${employerId}/cac/object` });
const deleteObject = jest.fn().mockResolvedValue(undefined);
const readObject = jest.fn().mockResolvedValue(Buffer.from('document'));
const createObjectKey = jest.fn(() => `employers/${employerId}/cac/generated.pdf`);

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({ createNotification }));
jest.unstable_mockModule('../src/services/storage/storage.service.js', () => ({
  createObjectKey,
  deleteObject,
  readObject,
  uploadObject,
}));

const { approveEmployerVerification, deleteVerificationDocumentForUser, getEmployerVerification, readVerificationDocumentForAdmin, readVerificationDocumentForUser, rejectEmployerVerification, submitEmployerVerification, uploadVerificationDocument } = await import('../src/services/employerVerification.service.js');

const fullVerification = (overrides = {}) => ({
  id: verificationId,
  userId: employerId,
  status: 'PENDING',
  submittedAt: new Date('2026-09-17T12:00:00.000Z'),
  reviewedById: null,
  reviewedAt: null,
  declineReason: null,
  registrationNumber: 'RC123456',
  registrationType: 'CAC',
  createdAt: new Date('2026-09-17T11:00:00.000Z'),
  updatedAt: new Date('2026-09-17T12:00:00.000Z'),
  user: {
    id: employerId,
    email: 'employer@example.com',
    phone: '+2348000000000',
    firstName: 'Example',
    lastName: 'Employer',
    employerProfile: {
      companyName: 'Example Ltd',
      companyDescription: 'A company',
      website: 'https://example.com',
      industry: 'Technology',
      companySize: '11-50',
      location: 'Lagos',
      address: '1 Main Street',
      state: 'Lagos',
      country: 'Nigeria',
      linkedinUrl: null,
      twitterUrl: null,
      facebookUrl: null,
      companyLogoUrl: null,
    },
  },
  documents: [],
  ...overrides,
});

const file = (overrides = {}) => ({
  buffer: Buffer.from('valid document'),
  size: 15,
  mimetype: 'application/pdf',
  originalname: 'cac.pdf',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.user.findUnique.mockResolvedValue({ employerProfile: { companyName: 'Example Ltd' } });
  mockPrisma.employerVerification.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.employerVerificationDocument.delete.mockResolvedValue({ id: documentId });
});

describe('Employer verification lifecycle', () => {
  test('returns the submitted company snapshot separately from the current public profile', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue(fullVerification({
      companyName: 'Submitted Company',
      companyDescription: 'Submitted description',
      website: 'https://submitted.example.com',
      user: {
        ...fullVerification().user,
        employerProfile: { ...fullVerification().user.employerProfile, companyName: 'Current Public Company' },
      },
    }));

    const result = await getEmployerVerification(employerId);

    expect(result.verification.submittedCompany).toMatchObject({
      companyName: 'Submitted Company',
      companyDescription: 'Submitted description',
      website: 'https://submitted.example.com',
    });
    expect(result.verification.submittedCompanySource).toBe('SUBMITTED');
    expect(result.verification.employer.company.companyName).toBe('Current Public Company');
  });

  test('creates a first submission with a submission timestamp', async () => {
    mockPrisma.employerVerification.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fullVerification());
    mockPrisma.employerVerification.create.mockResolvedValue({ id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date() });

    const result = await submitEmployerVerification(employerId, { registrationNumber: 'RC123456', registrationType: 'CAC' });

    expect(result.verification.status).toBe('PENDING');
    expect(mockPrisma.employerVerification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', registrationNumber: 'RC123456' }),
    }));
  });

  test('rejects duplicate pending submissions', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue({
      id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date(),
    });

    await expect(submitEmployerVerification(employerId, { registrationNumber: 'RC123456' })).rejects.toMatchObject({
      status: 409,
      publicCode: 'VERIFICATION_STATE_CONFLICT',
    });
    expect(mockPrisma.employerVerification.updateMany).not.toHaveBeenCalled();
  });

  test('converts a concurrent create conflict into a business conflict', async () => {
    mockPrisma.employerVerification.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date() });
    mockPrisma.employerVerification.create.mockRejectedValue({ code: 'P2002' });

    await expect(submitEmployerVerification(employerId, { registrationNumber: 'RC123456' })).rejects.toMatchObject({
      status: 409,
      publicCode: 'VERIFICATION_STATE_CONFLICT',
    });
  });

  test('resubmission moves declined verification to pending with a new timestamp', async () => {
    const previousSubmission = new Date('2026-09-10T12:00:00.000Z');
    mockPrisma.employerVerification.findUnique
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'REJECTED', submittedAt: previousSubmission })
      .mockResolvedValueOnce(fullVerification({ status: 'PENDING', declineReason: 'Upload a clearer certificate' }));

    await submitEmployerVerification(employerId, { registrationNumber: 'RC999999', registrationType: 'BN' });

    const updateData = mockPrisma.employerVerification.updateMany.mock.calls[0][0];
    expect(updateData.where).toEqual({ id: verificationId, status: 'REJECTED' });
    expect(updateData.data).toEqual(expect.objectContaining({ status: 'PENDING', registrationNumber: 'RC999999' }));
    expect(updateData.data.submittedAt).not.toEqual(previousSubmission);
  });

  test('approved verification cannot be resubmitted', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue({
      id: verificationId, userId: employerId, status: 'APPROVED', submittedAt: new Date(),
    });

    await expect(submitEmployerVerification(employerId, { registrationNumber: 'RC123456' })).rejects.toMatchObject({
      status: 409,
      message: 'Your company is already verified.',
    });
  });

  test('approval and decline only update submitted pending records', async () => {
    mockPrisma.employerVerification.findUnique
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date(), user: { email: 'employer@example.com' } })
      .mockResolvedValueOnce(fullVerification({ status: 'APPROVED' }))
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date(), user: { email: 'employer@example.com' } })
      .mockResolvedValueOnce(fullVerification({ status: 'REJECTED', declineReason: 'Reason' }));

    await approveEmployerVerification(adminId, verificationId);
    await rejectEmployerVerification(adminId, verificationId, 'Reason');

    expect(mockPrisma.employerVerification.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: verificationId, status: 'PENDING', submittedAt: { not: null } } }));
    expect(mockPrisma.employerVerification.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: verificationId, status: 'PENDING', submittedAt: { not: null } } }));
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  test('approval keeps profile sync and verification transition inside one transaction', async () => {
    const transactionError = new Error('verification transition failed');
    mockPrisma.employerVerification.findUnique.mockResolvedValue({
      id: verificationId,
      userId: employerId,
      status: 'PENDING',
      submittedAt: new Date(),
      companyName: 'Submitted Company',
      user: { email: 'employer@example.com' },
    });
    mockPrisma.employerProfile.upsert.mockResolvedValue({ id: 'profile-1' });
    mockPrisma.employerVerification.updateMany.mockRejectedValue(transactionError);

    await expect(approveEmployerVerification(adminId, verificationId)).rejects.toBe(transactionError);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.employerProfile.upsert).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('a repeated approval does not create a second notification', async () => {
    mockPrisma.employerVerification.findUnique
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'PENDING', submittedAt: new Date(), user: { email: 'employer@example.com' } })
      .mockResolvedValueOnce(fullVerification({ status: 'APPROVED' }))
      .mockResolvedValueOnce({ id: verificationId, userId: employerId, status: 'APPROVED', submittedAt: new Date(), user: { email: 'employer@example.com' } });

    await approveEmployerVerification(adminId, verificationId);
    await expect(approveEmployerVerification(adminId, verificationId)).rejects.toMatchObject({ status: 409 });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  test('decline requires a meaningful reason and approved records cannot be declined', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue({ id: verificationId, userId: employerId, status: 'APPROVED', submittedAt: new Date() });

    await expect(rejectEmployerVerification(adminId, verificationId, ' ')).rejects.toMatchObject({ status: 400 });
    await expect(rejectEmployerVerification(adminId, verificationId, 'Not acceptable')).rejects.toMatchObject({ status: 409 });
  });
});

describe('Employer verification document privacy and cleanup', () => {
  test('valid upload returns safe metadata without an object key', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue({ id: verificationId, status: 'REJECTED', submittedAt: new Date() });
    mockPrisma.employerVerificationDocument.create.mockResolvedValue({ id: documentId, kind: 'CAC', fileName: 'cac.pdf', contentType: 'application/pdf', fileSize: 15, objectKey: 'private/key', uploadedAt: new Date() });

    const result = await uploadVerificationDocument(employerId, file(), 'CAC');

    expect(result.document).toEqual(expect.objectContaining({ id: documentId, fileSize: 15 }));
    expect(result.document).not.toHaveProperty('objectKey');
  });

  test.each([
    [file({ mimetype: 'text/plain' }), 'CAC'],
    [file({ size: 11 * 1024 * 1024 }), 'CAC'],
    [file({ buffer: Buffer.alloc(0), size: 0 }), 'CAC'],
    [file(), 'INVALID'],
  ])('rejects invalid document input', async (invalidFile, kind) => {
    await expect(uploadVerificationDocument(employerId, invalidFile, kind)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  test('cleans up an uploaded object when metadata persistence fails', async () => {
    mockPrisma.employerVerification.findUnique.mockResolvedValue({ id: verificationId, status: 'REJECTED', submittedAt: new Date() });
    mockPrisma.employerVerificationDocument.create.mockRejectedValue({ code: 'P2002' });

    await expect(uploadVerificationDocument(employerId, file(), 'CAC')).rejects.toMatchObject({ status: 409, publicCode: 'VERIFICATION_STATE_CONFLICT' });
    expect(deleteObject).toHaveBeenCalledWith(expect.stringContaining('employers/'));
  });

  test('owner can read a document while another employer cannot', async () => {
    mockPrisma.employerVerificationDocument.findFirst.mockResolvedValueOnce({ id: documentId, contentType: 'application/pdf', objectKey: 'private/key', fileName: 'cac.pdf' }).mockResolvedValueOnce(null);

    await expect(readVerificationDocumentForUser(employerId, documentId)).resolves.toMatchObject({ contentType: 'application/pdf' });
    await expect(readVerificationDocumentForUser('55555555-5555-4555-8555-555555555555', documentId)).rejects.toMatchObject({ status: 404 });
  });

  test('admin can read a document by database id', async () => {
    mockPrisma.employerVerificationDocument.findUnique.mockResolvedValue({ id: documentId, contentType: 'application/pdf', objectKey: 'private/key', fileName: 'cac.pdf', kind: 'CAC', verification: { id: verificationId, userId: employerId } });

    await expect(readVerificationDocumentForAdmin(documentId)).resolves.toMatchObject({ verificationId, kind: 'CAC' });
  });

  test('owner cannot delete documents while review is active', async () => {
    mockPrisma.employerVerificationDocument.findFirst.mockResolvedValue({ id: documentId, objectKey: 'private/key', verification: { status: 'PENDING', submittedAt: new Date() } });

    await expect(deleteVerificationDocumentForUser(employerId, documentId)).rejects.toMatchObject({ status: 409 });
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
