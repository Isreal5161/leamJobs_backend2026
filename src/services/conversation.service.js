import { prisma } from '../config/database.js';

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationNotFoundError';
    this.status = 404;
  }
}

export class ApplicationNotFoundError extends Error {
  constructor() {
    super('Application not found');
    this.name = 'ApplicationNotFoundError';
    this.status = 404;
  }
}

const employerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employerProfile: {
    select: {
      companyName: true,
      companyLogoUrl: true,
    },
  },
};

const seekerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  seekerProfile: {
    select: {
      professionalTitle: true,
      profilePictureUrl: true,
      location: true,
    },
  },
};

const jobSelect = { id: true, title: true, location: true, jobType: true };

const conversationInclude = {
  employer: { select: employerSelect },
  seeker: { select: seekerSelect },
  job: { select: jobSelect },
  application: { select: { id: true, status: true, jobId: true } },
};

const mapEmployer = (employer) => ({
  id: employer.id,
  firstName: employer.firstName,
  lastName: employer.lastName,
  companyName: employer.employerProfile?.companyName ?? null,
  companyLogoUrl: employer.employerProfile?.companyLogoUrl ?? null,
});

const mapSeeker = (seeker) => ({
  id: seeker.id,
  firstName: seeker.firstName,
  lastName: seeker.lastName,
  professionalTitle: seeker.seekerProfile?.professionalTitle ?? null,
  profilePictureUrl: null,
  location: seeker.seekerProfile?.location ?? null,
});

const mapConversation = (conversation) => ({
  id: conversation.id,
  seeker: conversation.seeker ? mapSeeker(conversation.seeker) : undefined,
  employer: mapEmployer(conversation.employer),
  job: conversation.job,
  application: conversation.application,
  lastMessage: conversation.messages?.[0] ? {
    id: conversation.messages[0].id,
    body: conversation.messages[0].body,
    senderId: conversation.messages[0].senderId,
    createdAt: conversation.messages[0].createdAt,
    readAt: conversation.messages[0].readAt,
  } : null,
  lastMessageAt: conversation.lastMessageAt,
  unreadCount: conversation._count?.messages ?? 0,
});

const getUnreadCount = (conversationId, seekerId) => prisma.message.count({
  where: { conversationId, senderId: { not: seekerId }, readAt: null },
});

export const getSeekerConversations = async (seekerId) => {
  const conversations = await prisma.conversation.findMany({
    where: { seekerId },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
    include: {
      ...conversationInclude,
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
    },
  });

  const unreadCounts = await Promise.all(conversations.map((conversation) => getUnreadCount(conversation.id, seekerId)));
  return conversations.map((conversation, index) => ({
    ...mapConversation(conversation),
    unreadCount: unreadCounts[index],
  }));
};

export const getEmployerConversations = async (employerId) => {
  const conversations = await prisma.conversation.findMany({
    where: { employerId },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
    include: {
      ...conversationInclude,
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
    },
  });

  const unreadCounts = await Promise.all(conversations.map((conversation) => getUnreadCountForUser(conversation.id, employerId)));
  return conversations.map((conversation, index) => ({
    ...mapConversation(conversation),
    unreadCount: unreadCounts[index],
  }));
};

export const getSeekerConversation = async (seekerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, seekerId },
    include: conversationInclude,
  });

  if (!conversation) throw new ConversationNotFoundError();
  return { ...mapConversation(conversation), unreadCount: await getUnreadCount(conversation.id, seekerId) };
};

export const getEmployerConversation = async (employerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, employerId },
    include: conversationInclude,
  });

  if (!conversation) throw new ConversationNotFoundError();
  return { ...mapConversation(conversation), unreadCount: await getUnreadCountForUser(conversation.id, employerId) };
};

export const getOrCreateConversationForApplication = async (seekerId, applicationId) => {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, seekerId },
    select: { id: true, jobId: true, job: { select: { employerId: true } } },
  });

  if (!application) throw new ApplicationNotFoundError();

  const existing = await prisma.conversation.findUnique({
    where: { applicationId: application.id },
    include: conversationInclude,
  });
  if (existing) return { ...mapConversation(existing), unreadCount: await getUnreadCount(existing.id, seekerId) };

  try {
    const created = await prisma.conversation.create({
      data: {
        seekerId,
        employerId: application.job.employerId,
        jobId: application.jobId,
        applicationId: application.id,
      },
      include: conversationInclude,
    });
    return { ...mapConversation(created), unreadCount: 0 };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await prisma.conversation.findUnique({ where: { applicationId: application.id }, include: conversationInclude });
    if (!concurrent) throw error;
    return { ...mapConversation(concurrent), unreadCount: await getUnreadCount(concurrent.id, seekerId) };
  }
};

export const getOrCreateEmployerConversationForApplication = async (employerId, jobId, applicationId) => {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, jobId, job: { employerId } },
    select: { id: true, jobId: true, seekerId: true },
  });

  if (!application) throw new ApplicationNotFoundError();

  const existing = await prisma.conversation.findUnique({
    where: { applicationId: application.id },
    include: conversationInclude,
  });
  if (existing) {
    if (existing.employerId !== employerId || existing.jobId !== jobId) throw new ConversationNotFoundError();
    return { ...mapConversation(existing), unreadCount: await getUnreadCountForUser(existing.id, employerId) };
  }

  try {
    const created = await prisma.conversation.create({
      data: {
        seekerId: application.seekerId,
        employerId,
        jobId: application.jobId,
        applicationId: application.id,
      },
      include: conversationInclude,
    });
    return { ...mapConversation(created), unreadCount: 0 };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await prisma.conversation.findUnique({ where: { applicationId: application.id }, include: conversationInclude });
    if (!concurrent || concurrent.employerId !== employerId || concurrent.jobId !== jobId) throw new ConversationNotFoundError();
    return { ...mapConversation(concurrent), unreadCount: await getUnreadCountForUser(concurrent.id, employerId) };
  }
};

export const markSeekerConversationRead = async (seekerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, seekerId }, select: { id: true } });
  if (!conversation) throw new ConversationNotFoundError();

  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: seekerId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { conversationId, unreadCount: await getUnreadCount(conversationId, seekerId) };
};

const getUnreadCountForUser = (conversationId, userId) => prisma.message.count({
  where: { conversationId, senderId: { not: userId }, readAt: null },
});

export const markEmployerConversationRead = async (employerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, employerId }, select: { id: true } });
  if (!conversation) throw new ConversationNotFoundError();

  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: employerId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { conversationId, unreadCount: await getUnreadCountForUser(conversationId, employerId) };
};
