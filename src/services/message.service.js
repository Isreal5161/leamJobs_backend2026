import { prisma } from '../config/database.js';
import { ConversationNotFoundError } from './conversation.service.js';
import { createNotification } from './notification.service.js';

const resolveRecipientMessageLink = async (recipientUserId, client = prisma) => {
  const userClient = client?.user ?? prisma.user;
  if (!userClient) return '/seeker/messages';

  const user = await userClient.findUnique({
    where: { id: recipientUserId },
    select: { role: true },
  });

  if (user?.role === 'EMPLOYER') return '/employer/messages';
  if (user?.role === 'ADMIN') return '/admin/notifications';
  return '/seeker/messages';
};

const mapMessage = (message) => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  body: message.body,
  clientMessageId: message.clientMessageId,
  createdAt: message.createdAt,
  readAt: message.readAt,
});

const assertSeekerConversation = async (seekerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, seekerId },
    select: { id: true },
  });
  if (!conversation) throw new ConversationNotFoundError();
  return conversation;
};

const assertEmployerConversation = async (employerId, conversationId) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, employerId },
    select: { id: true },
  });
  if (!conversation) throw new ConversationNotFoundError();
  return conversation;
};

export const getSeekerMessages = async (seekerId, conversationId, { limit, cursor }) => {
  await assertSeekerConversation(seekerId, conversationId);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = messages.length > limit;
  const page = hasNextPage ? messages.slice(0, limit) : messages;
  return {
    messages: page.map(mapMessage),
    nextCursor: hasNextPage ? page[page.length - 1].id : null,
  };
};

export const sendSeekerMessage = async (seekerId, conversationId, { body, clientMessageId }) => {
  await assertSeekerConversation(seekerId, conversationId);

  if (clientMessageId) {
    const existing = await prisma.message.findUnique({
      where: { senderId_clientMessageId: { senderId: seekerId, clientMessageId } },
    });
    if (existing) return mapMessage(existing);
  }

  try {
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: { conversationId, senderId: seekerId, body, clientMessageId },
      });
      await (transaction.conversation?.update ?? prisma.conversation.update)({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });

      const conversationClient = transaction.conversation?.findUnique ?? prisma.conversation.findUnique;
      const conversation = await conversationClient({
        where: { id: conversationId },
        select: { employerId: true, seekerId: true },
      });

      const recipientUserId = conversation?.employerId && conversation.employerId !== seekerId ? conversation.employerId : conversation?.seekerId ?? null;
      if (recipientUserId) {
        const link = await resolveRecipientMessageLink(recipientUserId, transaction);
        await createNotification({
          recipientUserId,
          actorUserId: seekerId,
          type: 'INFO',
          category: 'MESSAGE',
          eventKey: `message:new:${conversationId}:${created.id}`,
          title: 'New message',
          message: `${body.length > 120 ? `${body.slice(0, 117)}...` : body}`,
          link,
        }, transaction).catch(() => undefined);
      }

      return created;
    });
    return mapMessage(message);
  } catch (error) {
    if (error?.code !== 'P2002' || !clientMessageId) throw error;
    const existing = await prisma.message.findUnique({
      where: { senderId_clientMessageId: { senderId: seekerId, clientMessageId } },
    });
    if (!existing) throw error;
    return mapMessage(existing);
  }
};

export const getEmployerMessages = async (employerId, conversationId, { limit, cursor }) => {
  await assertEmployerConversation(employerId, conversationId);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = messages.length > limit;
  const page = hasNextPage ? messages.slice(0, limit) : messages;
  return {
    messages: page.map(mapMessage),
    nextCursor: hasNextPage ? page[page.length - 1].id : null,
  };
};

export const sendEmployerMessage = async (employerId, conversationId, { body, clientMessageId }) => {
  await assertEmployerConversation(employerId, conversationId);

  if (clientMessageId) {
    const existing = await prisma.message.findUnique({
      where: { senderId_clientMessageId: { senderId: employerId, clientMessageId } },
    });
    if (existing) return mapMessage(existing);
  }

  try {
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: { conversationId, senderId: employerId, body, clientMessageId },
      });
      await (transaction.conversation?.update ?? prisma.conversation.update)({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });

      const conversationClient = transaction.conversation?.findUnique ?? prisma.conversation.findUnique;
      const conversation = await conversationClient({
        where: { id: conversationId },
        select: { employerId: true, seekerId: true },
      });

      const recipientUserId = conversation?.seekerId && conversation.seekerId !== employerId ? conversation.seekerId : conversation?.employerId ?? null;
      if (recipientUserId) {
        const link = await resolveRecipientMessageLink(recipientUserId, transaction);
        await createNotification({
          recipientUserId,
          actorUserId: employerId,
          type: 'INFO',
          category: 'MESSAGE',
          eventKey: `message:new:${conversationId}:${created.id}`,
          title: 'New message',
          message: `${body.length > 120 ? `${body.slice(0, 117)}...` : body}`,
          link,
        }, transaction).catch(() => undefined);
      }

      return created;
    });
    return mapMessage(message);
  } catch (error) {
    if (error?.code !== 'P2002' || !clientMessageId) throw error;
    const existing = await prisma.message.findUnique({
      where: { senderId_clientMessageId: { senderId: employerId, clientMessageId } },
    });
    if (!existing) throw error;
    return mapMessage(existing);
  }
};
