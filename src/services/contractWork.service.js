import { prisma } from '../config/database.js';
import { createObjectKey, deleteObject, readObject, uploadObject } from './storage/storage.service.js';

const attachmentSelect = {
  id: true,
  fileName: true,
  contentType: true,
  fileSize: true,
  createdAt: true,
};

const activityInclude = {
  actor: { select: { firstName: true, lastName: true } },
  attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
};

const getContract = async (db, contractId, userId, role) => {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      employerId: true,
      seekerId: true,
      status: true,
      employer: { select: { firstName: true, lastName: true } },
      seeker: { select: { firstName: true, lastName: true } },
      freelanceDetails: {
        select: {
          workStatus: true,
          completionSubmittedAt: true,
          escrow: { select: { status: true } },
        },
      },
    },
  });
  if (!contract || (role === 'EMPLOYER' ? contract.employerId : contract.seekerId) !== userId) {
    throw Object.assign(new Error('Contract not found'), { status: 404 });
  }
  return contract;
};

const ensureWorkIsOpen = (contract) => {
  const details = contract.freelanceDetails;
  if (!details || !['ACTIVE', 'IN_PROGRESS'].includes(contract.status)
    || details.workStatus === 'CANCELLED'
    || details.workStatus === 'COMPLETED'
    || details.completionSubmittedAt
    || details.escrow?.status !== 'FUNDED') {
    throw Object.assign(new Error('Contract work is not available for updates'), { status: 409 });
  }
};

const mapActivity = (activity) => ({
  id: activity.id,
  type: activity.type,
  status: activity.progressStatus,
  description: activity.description,
  links: Array.isArray(activity.links) ? activity.links : [],
  submissionVersion: activity.submissionVersion,
  parentActivityId: activity.parentActivityId,
  actor: activity.actor
    ? `${activity.actor.firstName} ${activity.actor.lastName}`.trim()
    : activity.actorName,
  createdAt: activity.createdAt,
  attachments: activity.attachments.map((attachment) => ({ ...attachment })),
});

const validateDescription = (description, required = true) => {
  if (typeof description !== 'string') {
    if (!required) return '';
    throw Object.assign(new Error('A description is required'), { status: 400 });
  }
  const normalized = description.trim();
  if ((required && !normalized) || normalized.length > 5000) {
    throw Object.assign(new Error('Description must contain between 1 and 5000 characters'), { status: 400 });
  }
  return normalized;
};

const validateLinks = (links = []) => {
  if (!Array.isArray(links) || links.length > 10) {
    throw Object.assign(new Error('Provide no more than 10 deliverable links'), { status: 400 });
  }
  return links.map((link) => {
    if (typeof link !== 'string' || link.length > 2048) {
      throw Object.assign(new Error('Each deliverable link must be a valid HTTPS URL'), { status: 400 });
    }
    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      throw Object.assign(new Error('Each deliverable link must be a valid HTTPS URL'), { status: 400 });
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw Object.assign(new Error('Each deliverable link must be a valid HTTPS URL'), { status: 400 });
    }
    return parsed.href;
  });
};

const validateAttachment = (file) => {
  if (!file?.buffer?.length) throw Object.assign(new Error('A non-empty attachment is required'), { status: 400 });
  const fileName = String(file.originalname ?? '').trim();
  if (!fileName || fileName.length > 255 || /[<>:"/\\|?*\u0000-\u001f]/.test(fileName)) {
    throw Object.assign(new Error('The attachment file name is invalid'), { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    throw Object.assign(new Error('Attachments must be 10 MB or smaller'), { status: 413 });
  }

  const extension = fileName.split('.').pop()?.toLowerCase();
  const mimeType = String(file.mimetype ?? '').toLowerCase();
  const signature = {
    pdf: mimeType === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-',
    doc: ['application/msword', 'application/octet-stream'].includes(mimeType)
      && file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
    docx: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
      'application/octet-stream',
    ].includes(mimeType)
      && file.buffer.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))
      && file.buffer.includes(Buffer.from('[Content_Types].xml')),
    jpg: mimeType === 'image/jpeg' && file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    jpeg: mimeType === 'image/jpeg' && file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    png: mimeType === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp: mimeType === 'image/webp' && file.buffer.subarray(0, 4).toString() === 'RIFF' && file.buffer.subarray(8, 12).toString() === 'WEBP',
  };
  if (!signature[extension]) {
    throw Object.assign(new Error('Only valid PDF, DOC, DOCX, JPG, PNG, and WEBP files are supported'), { status: 415 });
  }
  return { extension: extension === 'jpg' ? 'jpeg' : extension, fileName, contentType: mimeType };
};

const actorNameFor = (contract, role) => {
  const actor = role === 'EMPLOYER' ? contract.employer : contract.seeker;
  return `${actor.firstName} ${actor.lastName}`.trim();
};

export const listContractActivities = async ({ contractId, userId, role }) => {
  await getContract(prisma, contractId, userId, role);
  const activities = await prisma.contractActivity.findMany({
    where: { contractId },
    include: activityInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return activities.map(mapActivity);
};

export const createContractProgressUpdate = async ({ contractId, userId, role, description, status }) => {
  const normalizedDescription = validateDescription(description);
  const activity = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE`;
    const contract = await getContract(transaction, contractId, userId, role);
    ensureWorkIsOpen(contract);
    return transaction.contractActivity.create({
      data: {
        contractId,
        actorId: userId,
        actorName: actorNameFor(contract, role),
        type: 'PROGRESS_UPDATE',
        progressStatus: status,
        description: normalizedDescription,
      },
      include: activityInclude,
    });
  });
  return mapActivity({ ...activity, contractId });
};

export const submitContractWork = async ({ contractId, userId, description, links = [], files = [] }) => {
  const role = 'SEEKER';
  const initialContract = await getContract(prisma, contractId, userId, 'SEEKER');
  ensureWorkIsOpen(initialContract);
  if (files.length > 5) throw Object.assign(new Error('You can attach up to 5 files per submission'), { status: 400 });
  const normalizedDescription = validateDescription(description, false);
  const normalizedLinks = validateLinks(links);
  if (!normalizedDescription && !normalizedLinks.length && !files.length) {
    throw Object.assign(new Error('Add a description, link, or file to the submission'), { status: 400 });
  }
  const validatedFiles = files.map(validateAttachment);
  const storedFiles = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const validated = validatedFiles[index];
      const objectKey = createObjectKey({ userId, category: 'contract-work', extension: validated.extension, namespace: 'contracts' });
      await uploadObject({ objectKey, buffer: file.buffer });
      storedFiles.push({ ...validated, fileSize: file.size, objectKey });
    }

    const activity = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE
      `;
      const contract = await getContract(transaction, contractId, userId, 'SEEKER');
      ensureWorkIsOpen(contract);
      const latest = await transaction.contractActivity.findFirst({
        where: { contractId, type: 'SUBMISSION' },
        orderBy: { submissionVersion: 'desc' },
        include: { replies: { where: { type: { in: ['REVISION_REQUEST', 'APPROVAL'] } }, select: { type: true } } },
      });
      if (latest && !latest.replies.some((reply) => reply.type === 'REVISION_REQUEST')) {
        throw Object.assign(new Error('A revision must be requested before another submission can be made'), { status: 409 });
      }
      const submissionVersion = (latest?.submissionVersion ?? 0) + 1;
      const created = await transaction.contractActivity.create({
        data: {
          contractId,
          actorId: userId,
          actorName: actorNameFor(contract, role),
          type: 'SUBMISSION',
          progressStatus: 'SUBMITTED_FOR_REVIEW',
          description: normalizedDescription || 'Deliverables submitted.',
          links: normalizedLinks,
          submissionVersion,
          attachments: { create: storedFiles.map(({ fileName, contentType, fileSize, objectKey }) => ({ fileName, contentType, fileSize, objectKey })) },
        },
        include: activityInclude,
      });
      return created;
    });
    return mapActivity({ ...activity, contractId });
  } catch (error) {
    await Promise.all(storedFiles.map(({ objectKey }) => deleteObject(objectKey)));
    throw error;
  }
};

export const reviewContractSubmission = async ({ contractId, submissionId, userId, action, description = '' }) => {
  const activityDescription = validateDescription(description, action !== 'APPROVE');
  const activity = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE`;
    const contract = await getContract(transaction, contractId, userId, 'EMPLOYER');
    ensureWorkIsOpen(contract);
    const submission = await transaction.contractActivity.findFirst({
      where: { id: submissionId, contractId, type: 'SUBMISSION' },
      include: { replies: { where: { type: { in: ['REVISION_REQUEST', 'APPROVAL'] } }, select: { type: true } } },
    });
    if (!submission) throw Object.assign(new Error('Submission not found'), { status: 404 });
    if (submission.replies.some((reply) => reply.type === 'REVISION_REQUEST' || reply.type === 'APPROVAL')) {
      throw Object.assign(new Error('This submission has already been reviewed'), { status: 409 });
    }
    const eventType = action === 'REQUEST_REVISION' ? 'REVISION_REQUEST' : action === 'APPROVE' ? 'APPROVAL' : 'FEEDBACK';
    return transaction.contractActivity.create({
      data: {
        contractId,
        parentActivityId: submission.id,
        actorId: userId,
        actorName: actorNameFor(contract, 'EMPLOYER'),
        type: eventType,
        description: action === 'APPROVE' && !activityDescription ? 'Submission approved.' : activityDescription,
      },
      include: activityInclude,
    });
  });
  return mapActivity({ ...activity, contractId });
};

export const readContractWorkAttachment = async ({ contractId, activityId, attachmentId, userId, role }) => {
  await getContract(prisma, contractId, userId, role);
  const attachment = await prisma.contractWorkAttachment.findFirst({
    where: { id: attachmentId, activityId, activity: { contractId } },
  });
  if (!attachment) throw Object.assign(new Error('Attachment not found'), { status: 404 });
  return { ...attachment, buffer: await readObject(attachment.objectKey) };
};
