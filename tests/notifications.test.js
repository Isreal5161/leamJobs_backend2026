import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  authSession: {
    findFirst: jest.fn().mockImplementation(async ({ where }) => ({
      userId: where.userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { isActive: true, role: where.id },
    })),
  },

  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  conversation: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  message: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  adminAccount: { findUnique: jest.fn() },
  adminPermission: { findUnique: jest.fn() },
  adminPermissionGrant: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');
const { createNotification, listNotificationsForUser, markNotificationRead, markAllNotificationsRead } = await import('../src/services/notification.service.js');
const { sendSeekerMessage } = await import('../src/services/message.service.js');

const userId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';
const adminId = '44444444-4444-4444-8444-444444444444';

const token = (role = 'SEEKER', sub = userId) => jwt.sign({ sub, role, sid: role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'SEEKER' });
  mockPrisma.notification.findMany.mockResolvedValue([]);
  mockPrisma.notification.findFirst.mockResolvedValue({
    id: notificationId,
    recipientUserId: userId,
    actorUserId: actorId,
    type: 'JOB_STATUS',
    category: 'JOB',
    eventKey: 'job:approved:job-1',
    title: 'Your job was approved',
    message: 'Your job is now live.',
    link: '/employer/jobs/job-1',
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-09-05T12:00:00.000Z'),
    updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    actor: { id: actorId, firstName: 'Jane', lastName: 'Doe' },
  });
  mockPrisma.notification.count.mockResolvedValue(0);
  mockPrisma.notification.findUnique.mockResolvedValue(null);
  mockPrisma.notification.create.mockResolvedValue({
    id: notificationId,
    recipientUserId: userId,
    actorUserId: actorId,
    type: 'JOB_STATUS',
    category: 'JOB',
    eventKey: 'job:approved:job-1',
    title: 'Your job was approved',
    message: 'Your job is now live.',
    link: '/employer/jobs/job-1',
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-09-05T12:00:00.000Z'),
  });
  mockPrisma.notification.update.mockResolvedValue({
    id: notificationId,
    recipientUserId: userId,
    actorUserId: actorId,
    type: 'JOB_STATUS',
    category: 'JOB',
    eventKey: 'job:approved:job-1',
    title: 'Your job was approved',
    message: 'Your job is now live.',
    link: '/employer/jobs/job-1',
    metadata: null,
    isRead: true,
    readAt: new Date('2026-09-05T12:05:00.000Z'),
    createdAt: new Date('2026-09-05T12:00:00.000Z'),
  });
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 2 });
  mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1', seekerId: userId, employerId: actorId });
  mockPrisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', seekerId: userId, employerId: actorId });
  mockPrisma.user.findUnique.mockResolvedValue({ id: actorId, role: 'EMPLOYER' });
  mockPrisma.message.findUnique.mockResolvedValue(null);
});

describe('notification service', () => {
  test('creates a notification with deduplication by eventKey', async () => {
    mockPrisma.notification.findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: notificationId });

    const created = await createNotification({
      recipientUserId: userId,
      actorUserId: actorId,
      type: 'JOB_STATUS',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
      link: '/employer/jobs/job-1',
    });

    expect(created).toMatchObject({ recipientUserId: userId, title: 'Your job was approved', isRead: false });
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
  });

  test('returns the concurrently-created notification when the unique key races', async () => {
    mockPrisma.notification.findFirst.mockReset();
    mockPrisma.notification.findFirst.mockResolvedValue(null);
    mockPrisma.notification.create.mockRejectedValue({ code: 'P2002' });
    const duplicate = {
      id: notificationId,
      recipientUserId: userId,
      actorUserId: actorId,
      type: 'INFO',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
      link: '/employer/jobs/job-1',
      metadata: null,
      isRead: false,
      readAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
      actor: null,
    };
    mockPrisma.notification.findUnique.mockReset();
    mockPrisma.notification.findUnique.mockResolvedValue(duplicate);

    await expect(createNotification({
      recipientUserId: userId,
      actorUserId: actorId,
      type: 'INFO',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
    })).resolves.toMatchObject({ id: notificationId, recipientUserId: userId });
    expect(mockPrisma.notification.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientUserId_eventKey: { recipientUserId: userId, eventKey: 'job:approved:job-1' } },
    }));
  });

  test('lists notifications with unread count and marks them read', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{
      id: notificationId,
      recipientUserId: userId,
      actorUserId: actorId,
      type: 'JOB_STATUS',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
      link: '/employer/jobs/job-1',
      metadata: null,
      isRead: false,
      readAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      actor: { id: actorId, firstName: 'Jane', lastName: 'Doe' },
    }]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const list = await listNotificationsForUser(userId, { limit: 20 });
    expect(list.notifications).toHaveLength(1);
    expect(list.unreadCount).toBe(1);

    const read = await markNotificationRead(userId, notificationId);
    expect(read.notification.isRead).toBe(true);
    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: notificationId, recipientUserId: userId },
    }));

    const allRead = await markAllNotificationsRead(userId);
    expect(allRead.count).toBe(2);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientUserId: userId, isRead: false },
    }));
  });

  test('cannot mark another users notification as read', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    await expect(markNotificationRead(userId, notificationId))
      .rejects.toMatchObject({ status: 404 });

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: notificationId, recipientUserId: userId },
      select: { id: true, isRead: true },
    });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  test('creates an in-app notification when a seeker sends a message', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1', seekerId: userId, employerId: actorId });
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.notification.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (transactionFn) => {
      const tx = {
        message: {
          create: jest.fn().mockResolvedValue({
            id: 'msg-1',
            conversationId: 'conv-1',
            senderId: userId,
            body: 'Hi there',
            clientMessageId: null,
            createdAt: new Date('2026-09-05T12:00:00.000Z'),
            readAt: null,
          }),
        },
        conversation: {
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue({ employerId: actorId, seekerId: userId }),
        },
        notification: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'note-1',
            recipientUserId: actorId,
            actorUserId: userId,
            type: 'INFO',
            category: 'MESSAGE',
            eventKey: 'message:new:conv-1:msg-1',
            title: 'New message',
            message: 'Hi there',
            link: '/messages',
            metadata: null,
            isRead: false,
            readAt: null,
            createdAt: new Date('2026-09-05T12:00:00.000Z'),
            updatedAt: new Date('2026-09-05T12:00:00.000Z'),
            actor: null,
          }),
        },
      };
      return transactionFn(tx);
    });

    const message = await sendSeekerMessage(userId, 'conv-1', { body: 'Hi there' });

    expect(message.body).toBe('Hi there');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const transactionFn = mockPrisma.$transaction.mock.calls[0][0];
    const transaction = {
      message: { create: jest.fn().mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', senderId: userId, body: 'Hi there', clientMessageId: null, createdAt: new Date('2026-09-05T12:00:00.000Z'), readAt: null }), findUnique: jest.fn() },
      conversation: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ employerId: actorId, seekerId: userId }) },
      notification: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'note-1', recipientUserId: actorId, actorUserId: userId, type: 'INFO', category: 'MESSAGE', eventKey: 'message:new:conv-1:msg-1', title: 'New message', message: 'Hi there', link: '/seeker/messages', metadata: null, isRead: false, readAt: null, createdAt: new Date('2026-09-05T12:00:00.000Z'), updatedAt: new Date('2026-09-05T12:00:00.000Z'), actor: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: actorId, role: 'EMPLOYER' }) },
    };

    await transactionFn(transaction);
    expect(transaction.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recipientUserId: actorId,
        title: 'New message',
      }),
    }));
    expect(transaction.notification.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipientUserId: userId }),
    }));
  });
});

describe('notification endpoints', () => {
  const authorizeAdminNotificationView = () => {
    mockPrisma.adminAccount.findUnique.mockResolvedValue({
      userId: adminId,
      tier: 'STAFF_ADMIN',
      suspendedAt: null,
      user: { id: adminId, role: 'ADMIN', isActive: true },
    });
    mockPrisma.adminPermission.findUnique.mockImplementation(async ({ where }) => ({
      key: where.key,
      isEnabled: true,
    }));
    mockPrisma.adminPermissionGrant.findUnique.mockImplementation(async ({ where }) => (
      where.adminUserId_permissionKey.adminUserId === adminId
      && where.adminUserId_permissionKey.permissionKey === 'notifications.view'
        ? { adminUserId: adminId }
        : null
    ));
  };

  test('lists only the authenticated user notifications', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'SEEKER' });
    mockPrisma.notification.findMany.mockResolvedValue([{
      id: notificationId,
      recipientUserId: userId,
      actorUserId: actorId,
      type: 'JOB_STATUS',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
      link: '/employer/jobs/job-1',
      metadata: null,
      isRead: false,
      readAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      actor: { id: actorId, firstName: 'Jane', lastName: 'Doe' },
    }]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/seeker/notifications')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.notifications[0].title).toBe('Your job was approved');
    expect(response.body.data.unreadCount).toBe(1);
    expect(mockPrisma.notification.findMany).toHaveBeenCalled();
  });

  test('marks a notification read for the authenticated user only', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'SEEKER' });
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: notificationId,
      recipientUserId: userId,
      isRead: false,
      readAt: null,
      actorUserId: null,
      type: 'JOB_STATUS',
      category: 'JOB',
      eventKey: 'job:approved:job-1',
      title: 'Your job was approved',
      message: 'Your job is now live.',
      link: '/employer/jobs/job-1',
      metadata: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    });

    const response = await request(app)
      .patch(`/api/seeker/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.notification.isRead).toBe(true);
  });

  test('Admin Staff with notifications.view can mark only their own notification as read', async () => {
    authorizeAdminNotificationView();
    mockPrisma.notification.findFirst.mockResolvedValue({
      id: notificationId,
      recipientUserId: adminId,
      isRead: false,
    });
    mockPrisma.notification.update.mockResolvedValue({
      id: notificationId,
      recipientUserId: adminId,
      actorUserId: null,
      type: 'ALERT',
      category: 'PAYMENT',
      eventKey: 'admin:escrow-release-requested:contract-1',
      title: 'Payment Release Requested',
      message: 'A contract is awaiting review.',
      link: '/admin/contracts/contract-1',
      metadata: null,
      isRead: true,
      readAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      actor: null,
    });

    const response = await request(app)
      .patch(`/api/admin/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: notificationId, recipientUserId: adminId },
    }));
    expect(mockPrisma.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: notificationId },
    }));
    expect(mockPrisma.adminPermissionGrant.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminUserId_permissionKey: { adminUserId: adminId, permissionKey: 'notifications.view' } },
    }));
  });

  test('Admin Staff with notifications.view cannot mark another users notification as read', async () => {
    authorizeAdminNotificationView();
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch(`/api/admin/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: notificationId, recipientUserId: adminId },
    }));
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  test('Admin mark-all-read changes only the authenticated Admin notifications', async () => {
    authorizeAdminNotificationView();

    const response = await request(app)
      .patch('/api/admin/notifications/read-all')
      .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientUserId: adminId, isRead: false },
      data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
    });
  });
});
