import { prisma } from '../config/database.js';
import { ConversationNotFoundError } from './conversation.service.js';

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
      await transaction.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
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
