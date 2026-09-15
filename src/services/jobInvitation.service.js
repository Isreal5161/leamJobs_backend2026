import { prisma } from '../config/database.js';
import { createNotification } from './notification.service.js';

const invitationInclude = {
  job: { select: { id: true, title: true, location: true, status: true, applicationDeadline: true } },
  employer: { select: { id: true, firstName: true, lastName: true, employerProfile: { select: { companyName: true, companyLogoUrl: true } } } },
  seeker: { select: { id: true, firstName: true, lastName: true } },
  application: { select: { id: true, status: true, jobId: true } },
};

const activeCandidateWhere = (id) => ({ id, role: 'SEEKER', isActive: true, seekerProfile: { isNot: null } });

class InvitationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InvitationError';
    this.status = status;
  }
}

export class InvitationNotFoundError extends InvitationError {
  constructor() { super('Invitation not found', 404); }
}

const assertOpenOwnedJob = async (employerId, jobId, client = prisma) => {
  const job = await client.job.findFirst({
    where: { id: jobId, employerId, status: 'APPROVED' },
    select: { id: true, title: true, applicationDeadline: true, employer: { select: { employerProfile: { select: { companyName: true } } } } },
  });
  if (!job) throw new InvitationError('Job is not available for invitations', 404);
  if (job.applicationDeadline && job.applicationDeadline < new Date()) throw new InvitationError('Job is no longer accepting candidates', 409);
  return job;
};

const mapInvitation = (invitation) => ({
  id: invitation.id,
  status: invitation.status,
  message: invitation.message,
  createdAt: invitation.createdAt,
  respondedAt: invitation.respondedAt,
  expiresAt: invitation.expiresAt,
  job: invitation.job,
  employer: invitation.employer ? {
    id: invitation.employer.id,
    firstName: invitation.employer.firstName,
    lastName: invitation.employer.lastName,
    companyName: invitation.employer.employerProfile?.companyName ?? null,
    companyLogoUrl: invitation.employer.employerProfile?.companyLogoUrl ?? null,
  } : null,
  application: invitation.application,
});

export const createJobInvitation = async (employerId, { seekerId, jobId, message }) => {
  const [job, candidate] = await Promise.all([
    assertOpenOwnedJob(employerId, jobId),
    prisma.user.findFirst({ where: activeCandidateWhere(seekerId), select: { id: true } }),
  ]);
  if (!candidate) throw new InvitationError('Candidate is not eligible for invitations', 404);

  const existing = await prisma.jobInvitation.findFirst({ where: { employerId, seekerId, jobId, status: 'PENDING' }, select: { id: true } });
  if (existing) throw new InvitationError('A pending invitation already exists for this candidate and job', 409);

  try {
    const invitation = await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: { employerId, seekerId, jobId, lastMessageAt: new Date() },
      });
      const created = await transaction.jobInvitation.create({
        data: { employerId, seekerId, jobId, message, conversationId: conversation.id },
        include: invitationInclude,
      });
      await transaction.message.create({
        data: {
          conversationId: conversation.id,
          senderId: employerId,
          body: `JOB INVITATION\n${job.title}\n${message}`,
        },
      });

      await createNotification({
        recipientUserId: seekerId,
        actorUserId: employerId,
        type: 'INFO',
        category: 'INVITATION',
        eventKey: `invitation:pending:${created.id}`,
        title: 'Job invitation received',
        message: `${job.title} is awaiting your response from ${job.employer?.employerProfile?.companyName ?? 'an employer'}.`,
        link: `/seeker/jobs`,
      }, transaction).catch(() => undefined);

      return created;
    });
    return mapInvitation(invitation);
  } catch (error) {
    if (error?.code === 'P2002') throw new InvitationError('A pending invitation already exists for this candidate and job', 409);
    throw error;
  }
};

export const respondToJobInvitation = async (seekerId, invitationId, response) => {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "JobInvitation" WHERE "id" = ${invitationId} FOR UPDATE`;
    const invitation = await transaction.jobInvitation.findFirst({ where: { id: invitationId, seekerId }, include: invitationInclude });
    if (!invitation) throw new InvitationNotFoundError();
    if (invitation.status === 'DECLINED') return mapInvitation(invitation);
    if (invitation.status === 'ACCEPTED') return mapInvitation(invitation);
    if (invitation.status !== 'PENDING') throw new InvitationError('Invitation is no longer active', 409);

    if (response === 'DECLINED') {
      const updated = await transaction.jobInvitation.update({ where: { id: invitationId }, data: { status: 'DECLINED', respondedAt: new Date() }, include: invitationInclude });
      await createNotification({
        recipientUserId: invitation.employerId,
        actorUserId: seekerId,
        type: 'WARNING',
        category: 'INVITATION',
        eventKey: `invitation:declined:${updated.id}`,
        title: 'Invitation declined',
        message: `A candidate declined your invitation for ${updated.job.title}.`,
        link: `/employer/applicants`,
      }, transaction).catch(() => undefined);
      return mapInvitation(updated);
    }

    if (invitation.job.status !== 'APPROVED' || (invitation.job.applicationDeadline && invitation.job.applicationDeadline < new Date())) {
      throw new InvitationError('Job is no longer accepting candidates', 409);
    }

    let application = await transaction.application.findUnique({ where: { seekerId_jobId: { seekerId, jobId: invitation.jobId } }, select: { id: true, status: true, jobId: true } });
    if (!application) {
      application = await transaction.application.create({ data: { seekerId, jobId: invitation.jobId }, select: { id: true, status: true, jobId: true } });
    }
    const updated = await transaction.jobInvitation.update({ where: { id: invitationId }, data: { status: 'ACCEPTED', respondedAt: new Date(), applicationId: application.id }, include: invitationInclude });
    await createNotification({
      recipientUserId: invitation.employerId,
      actorUserId: seekerId,
      type: 'SUCCESS',
      category: 'INVITATION',
      eventKey: `invitation:accepted:${updated.id}`,
      title: 'Invitation accepted',
      message: `A candidate accepted your invitation for ${updated.job.title}.`,
      link: `/employer/applicants`,
    }, transaction).catch(() => undefined);
    return mapInvitation(updated);
  });
};
