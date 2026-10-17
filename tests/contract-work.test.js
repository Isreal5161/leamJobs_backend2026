import { jest } from '@jest/globals';

const employerId = '11111111-1111-4111-8111-111111111111';
const seekerId = '33333333-3333-4333-8333-333333333333';
const contractId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const contract = (overrides = {}) => ({
  id: contractId,
  employerId,
  seekerId,
  status: 'ACTIVE',
  employer: { firstName: 'Em', lastName: 'Ployer' },
  seeker: { firstName: 'Ada', lastName: 'Lovelace' },
  freelanceDetails: {
    workStatus: 'IN_PROGRESS',
    completionSubmittedAt: null,
    escrow: { status: 'FUNDED' },
  },
  ...overrides,
});

const mockPrisma = {
  contract: { findUnique: jest.fn() },
  contractActivity: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  contractWorkAttachment: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};
const mockStorage = {
  createObjectKey: jest.fn(() => 'contracts/seeker/contract-work/file.pdf'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  readObject: jest.fn(),
  uploadObject: jest.fn().mockResolvedValue({ objectKey: 'contracts/seeker/contract-work/file.pdf' }),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../src/services/storage/storage.service.js', () => mockStorage);
const {
  createContractProgressUpdate,
  listContractActivities,
  readContractWorkAttachment,
  reviewContractSubmission,
  submitContractWork,
} = await import('../src/services/contractWork.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.contract.findUnique.mockResolvedValue(contract());
  mockPrisma.contractActivity.findMany.mockResolvedValue([]);
  mockPrisma.contractActivity.findFirst.mockResolvedValue(null);
  mockPrisma.contractActivity.create.mockImplementation(async ({ data }) => ({
    id: 'activity-1',
    contractId,
    ...data,
    actor: { firstName: data.actorName.split(' ')[0], lastName: data.actorName.split(' ').slice(1).join(' ') },
    attachments: data.attachments?.create?.map((attachment, index) => ({ id: `file-${index}`, ...attachment, createdAt: new Date() })) ?? [],
    createdAt: new Date(),
  }));
  mockPrisma.contractWorkAttachment.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: contractId }]);
  mockStorage.uploadObject.mockResolvedValue({ objectKey: 'contracts/seeker/contract-work/file.pdf' });
});

test('seeker publishes a timestamped progress update without changing contract or payment state', async () => {
  const result = await createContractProgressUpdate({
    contractId, userId: seekerId, role: 'SEEKER', description: 'Completed the first milestone.', status: 'IN_PROGRESS',
  });

  expect(result).toMatchObject({ type: 'PROGRESS_UPDATE', status: 'IN_PROGRESS', actor: 'Ada Lovelace' });
  expect(result.createdAt).toBeInstanceOf(Date);
  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ contractId, actorId: seekerId, description: 'Completed the first milestone.' }),
  }));
  expect(mockPrisma.contract.update).toBeUndefined();
});

test('employer can view the contract activity history', async () => {
  mockPrisma.contractActivity.findMany.mockResolvedValue([{
    id: 'activity-1',
    contractId,
    type: 'PROGRESS_UPDATE',
    progressStatus: 'BLOCKED',
    description: 'Waiting on access.',
    links: null,
    submissionVersion: null,
    parentActivityId: null,
    actorName: 'Ada Lovelace',
    actor: null,
    createdAt: new Date(),
    attachments: [],
  }]);

  await expect(listContractActivities({ contractId, userId: employerId, role: 'EMPLOYER' })).resolves.toMatchObject([
    { type: 'PROGRESS_UPDATE', status: 'BLOCKED', actor: 'Ada Lovelace' },
  ]);
});

test('seeker submits an HTTPS deliverable link and a signature-validated private file as version one', async () => {
  mockPrisma.contractActivity.findFirst.mockResolvedValue(null);
  const pdf = { originalname: 'deliverable.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 file'), size: 13 };

  const result = await submitContractWork({
    contractId, userId: seekerId, description: 'First version', links: ['https://files.example.test/deliverable'], files: [pdf],
  });

  expect(result).toMatchObject({
    type: 'SUBMISSION',
    submissionVersion: 1,
    links: ['https://files.example.test/deliverable'],
    attachments: [{ fileName: 'deliverable.pdf', contentType: 'application/pdf', fileSize: 13 }],
  });
  expect(mockStorage.uploadObject).toHaveBeenCalledWith(expect.objectContaining({
    objectKey: 'contracts/seeker/contract-work/file.pdf',
    buffer: pdf.buffer,
  }));
  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ progressStatus: 'SUBMITTED_FOR_REVIEW', submissionVersion: 1 }),
  }));
});

test('invalid external links and file signatures are rejected before storage', async () => {
  await expect(submitContractWork({
    contractId, userId: seekerId, description: 'Invalid link', links: ['http://example.test'], files: [],
  })).rejects.toMatchObject({ status: 400 });
  await expect(submitContractWork({
    contractId,
    userId: seekerId,
    description: 'Invalid document',
    links: [],
    files: [{ originalname: 'fake.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf'), size: 9 }],
  })).rejects.toMatchObject({ status: 415 });
  expect(mockStorage.uploadObject).not.toHaveBeenCalled();
});

test('seeker can resubmit a new version after employer requests revision', async () => {
  mockPrisma.contractActivity.findFirst.mockResolvedValue({
    submissionVersion: 1,
    replies: [{ type: 'REVISION_REQUEST' }],
  });

  await submitContractWork({ contractId, userId: seekerId, description: 'Revised work', links: [], files: [] });

  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ submissionVersion: 2, description: 'Revised work' }),
  }));
});

test('employer can request a revision or approve a submission without completing the contract', async () => {
  mockPrisma.contractActivity.findFirst.mockResolvedValue({ id: 'submission-1', replies: [] });

  const result = await reviewContractSubmission({
    contractId, submissionId: 'submission-1', userId: employerId, action: 'REQUEST_REVISION', description: 'Please update section two.',
  });

  expect(result).toMatchObject({ type: 'REVISION_REQUEST', parentActivityId: 'submission-1' });
  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'REVISION_REQUEST', parentActivityId: 'submission-1' }),
  }));
  expect(mockPrisma.contract.update).toBeUndefined();
});

test('employer can send feedback on a submission without advancing contract state', async () => {
  mockPrisma.contractActivity.findFirst.mockResolvedValue({ id: 'submission-1', replies: [] });

  const result = await reviewContractSubmission({
    contractId, submissionId: 'submission-1', userId: employerId, action: 'FEEDBACK', description: 'The formatting looks good.',
  });

  expect(result).toMatchObject({ type: 'FEEDBACK', parentActivityId: 'submission-1' });
  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'FEEDBACK', description: 'The formatting looks good.' }),
  }));
});

test('explicit approval is an activity only and does not touch escrow', async () => {
  mockPrisma.contractActivity.findFirst.mockResolvedValue({ id: 'submission-1', replies: [] });

  await reviewContractSubmission({
    contractId, submissionId: 'submission-1', userId: employerId, action: 'APPROVE', description: '',
  });

  expect(mockPrisma.contractActivity.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'APPROVAL', description: 'Submission approved.' }),
  }));
  expect(mockPrisma.escrow).toBeUndefined();
});

test('unauthorized parties and cancelled or unfunded contracts cannot access or mutate work', async () => {
  await expect(listContractActivities({ contractId, userId: '44444444-4444-4444-8444-444444444444', role: 'EMPLOYER' }))
    .rejects.toMatchObject({ status: 404 });

  mockPrisma.contract.findUnique.mockResolvedValueOnce(contract({ status: 'CANCELLED' }));
  await expect(createContractProgressUpdate({
    contractId, userId: seekerId, role: 'SEEKER', description: 'Too late', status: 'BLOCKED',
  })).rejects.toMatchObject({ status: 409 });

  mockPrisma.contract.findUnique.mockResolvedValueOnce(contract({
    freelanceDetails: { workStatus: 'IN_PROGRESS', completionSubmittedAt: null, escrow: { status: 'UNFUNDED' } },
  }));
  await expect(submitContractWork({ contractId, userId: seekerId, description: 'Not funded', files: [] }))
    .rejects.toMatchObject({ status: 409 });
});

test('attachment access is limited to a contract participant', async () => {
  await expect(readContractWorkAttachment({
    contractId, activityId: 'activity-1', attachmentId: 'file-1',
    userId: '44444444-4444-4444-8444-444444444444', role: 'EMPLOYER',
  })).rejects.toMatchObject({ status: 404 });
  expect(mockStorage.readObject).not.toHaveBeenCalled();
});
