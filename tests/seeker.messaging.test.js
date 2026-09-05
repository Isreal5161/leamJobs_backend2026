import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  conversation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  application: { findFirst: jest.fn() },
  message: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';
const employerId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const applicationId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';
const messageId = '77777777-7777-4777-8777-777777777777';
const createdAt = new Date('2026-09-05T12:00:00.000Z');

const token = (role = 'SEEKER', sub = seekerId) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const employer = { id: employerId, firstName: 'Employer', lastName: 'User', employerProfile: { companyName: 'Example Ltd', companyLogoUrl: null } };
const conversation = { id: conversationId, seekerId, employerId, jobId, applicationId, lastMessageAt: createdAt, employer, job: { id: jobId, title: 'Frontend Developer', location: 'Lagos', jobType: 'NORMAL_EMPLOYMENT' }, application: { id: applicationId, status: 'APPLIED', jobId }, messages: [] };
const message = { id: messageId, conversationId, senderId: seekerId, body: 'Hello employer', clientMessageId: 'client-1', createdAt, readAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.message.count.mockResolvedValue(0);
  mockPrisma.conversation.findMany.mockResolvedValue([]);
  mockPrisma.conversation.findFirst.mockResolvedValue(conversation);
  mockPrisma.conversation.findUnique.mockResolvedValue(null);
  mockPrisma.application.findFirst.mockResolvedValue({ id: applicationId, jobId, job: { employerId } });
  mockPrisma.conversation.create.mockResolvedValue(conversation);
  mockPrisma.message.findMany.mockResolvedValue([message]);
  mockPrisma.message.findUnique.mockResolvedValue(null);
  mockPrisma.message.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback({
    message: { create: jest.fn().mockResolvedValue(message) },
    conversation: { update: jest.fn().mockResolvedValue(conversation) },
  }));
});

describe('seeker messaging endpoints', () => {
  test('lists only the authenticated seeker conversations', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([conversation]);

    const response = await request(app)
      .get('/api/seeker/conversations')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.conversations[0].employer.companyName).toBe('Example Ltd');
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seekerId } }));
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  test('creates a conversation only from the authenticated seeker application', async () => {
    const response = await request(app)
      .post(`/api/seeker/conversations/from-application/${applicationId}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: applicationId, seekerId } }));
    expect(mockPrisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { seekerId, employerId, jobId, applicationId },
    }));
  });

  test('returns 404 when another seeker application is requested', async () => {
    mockPrisma.application.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/seeker/conversations/from-application/${applicationId}`)
      .set('Authorization', `Bearer ${token('SEEKER', otherSeekerId)}`);

    expect(response.status).toBe(404);
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  test('returns 404 for a conversation owned by another seeker', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/seeker/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${token('SEEKER', otherSeekerId)}`);

    expect(response.status).toBe(404);
  });

  test('reads paginated messages for the owned conversation', async () => {
    const response = await request(app)
      .get(`/api/seeker/conversations/${conversationId}/messages?limit=1`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.messages[0]).toMatchObject({ id: messageId, body: 'Hello employer' });
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, where: { conversationId } }));
  });

  test('sends using the JWT seeker and rejects ownership fields', async () => {
    const response = await request(app)
      .post(`/api/seeker/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ body: 'Hello employer', senderId: otherSeekerId, seekerId: otherSeekerId });

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('sends a valid message through a transaction', async () => {
    const response = await request(app)
      .post(`/api/seeker/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ body: ' Hello employer ', clientMessageId: 'client-1' });

    expect(response.status).toBe(201);
    expect(response.body.data.message.senderId).toBe(seekerId);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test.each([{ body: '' }, { body: '   ' }, { body: 'x'.repeat(5001) }])('rejects invalid message body', async (payload) => {
    const response = await request(app)
      .post(`/api/seeker/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token()}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('marks only messages from the other participant as read', async () => {
    const response = await request(app)
      .patch(`/api/seeker/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId, senderId: { not: seekerId }, readAt: null },
    }));
  });

  test.each(['EMPLOYER', 'ADMIN'])('forbids %s from seeker messaging routes', async (role) => {
    const response = await request(app)
      .get('/api/seeker/conversations')
      .set('Authorization', `Bearer ${token(role)}`);

    expect(response.status).toBe(403);
    expect(mockPrisma.conversation.findMany).not.toHaveBeenCalled();
  });

  test('requires authentication', async () => {
    const response = await request(app).get('/api/seeker/conversations');
    expect(response.status).toBe(401);
  });
});
