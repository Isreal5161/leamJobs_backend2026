import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'interview-route-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const mockPrisma = {
  interview: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
  },
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({}),
  listNotificationsForUser: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));
const { default: app } = await import('../src/app.js');

const employerId = '11111111-1111-4111-8111-111111111111';
const otherEmployerId = '55555555-5555-4555-8555-555555555555';
const seekerId = '22222222-2222-4222-8222-222222222222';
const otherSeekerId = '66666666-6666-4666-8666-666666666666';
const jobId = '33333333-3333-4333-8333-333333333333';
const applicationId = '44444444-4444-4444-8444-444444444444';
const interviewId = '77777777-7777-4777-8777-777777777777';
const token = (role, sub) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  expiresIn: '1h',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.interview.findMany.mockResolvedValue([]);
  mockPrisma.interview.count.mockResolvedValue(0);
  mockPrisma.interview.findFirst.mockResolvedValue(null);
});

test('employer interview list is authenticated and scoped to the employer identity', async () => {
  const response = await request(app)
    .get('/api/employer/interviews')
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);
  expect(response.status).toBe(200);
  expect(response.body.data.interviews).toEqual([]);
  expect(response.body.data.pagination).toEqual(expect.objectContaining({ page: 1, limit: 20, total: 0 }));
  expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employerId } }));
});

test('seeker and unauthenticated users cannot use employer interview endpoints', async () => {
  const wrongRole = await request(app)
    .get('/api/employer/interviews')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);
  expect(wrongRole.status).toBe(403);

  const anonymous = await request(app).get('/api/employer/interviews');
  expect(anonymous.status).toBe(401);
  expect(mockPrisma.interview.findMany).not.toHaveBeenCalled();
});

test('seeker interview list is scoped to the authenticated seeker', async () => {
  const response = await request(app)
    .get('/api/seeker/interviews')
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);
  expect(response.status).toBe(200);
  expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { seekerId } }));
});

test('employer interview creation endpoint validates the payload before database access', async () => {
  const response = await request(app)
    .post(`/api/employer/jobs/${jobId}/applications/${applicationId}/interviews`)
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`)
    .send({ method: 'UNSUPPORTED', seekerId, scheduledAt: '2030-05-01T12:00:00Z', timezone: 'UTC' });
  expect(response.status).toBe(400);
  expect(response.body.message).toBe('Validation failed');
  expect(mockPrisma.interview.findMany).not.toHaveBeenCalled();
});

test('employer interview detail, reschedule, and cancellation are scoped to the authenticated employer', async () => {
  const employerBInterview = {
    id: interviewId,
    employerId: otherEmployerId,
    applicationId,
    jobId,
  };
  mockPrisma.interview.findFirst.mockImplementation(async ({ where }) =>
    where.employerId === employerBInterview.employerId ? employerBInterview : null);
  const auth = `Bearer ${token('EMPLOYER', employerId)}`;

  const detail = await request(app)
    .get(`/api/employer/interviews/${interviewId}`)
    .set('Authorization', auth);
  expect(detail.status).toBe(404);
  expect(mockPrisma.interview.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: interviewId, employerId },
  }));

  const reschedule = await request(app)
    .patch(`/api/employer/interviews/${interviewId}`)
    .set('Authorization', auth)
    .send({ localDate: '2030-05-01', localTime: '12:00', timezone: 'UTC' });
  expect(reschedule.status).toBe(404);
  expect(mockPrisma.interview.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: interviewId, employerId },
  }));

  const cancellation = await request(app)
    .post(`/api/employer/interviews/${interviewId}/cancel`)
    .set('Authorization', auth)
    .send({ reason: 'No longer available.' });
  expect(cancellation.status).toBe(404);
  expect(mockPrisma.interview.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: interviewId, employerId },
  }));
});

test('employer cannot access an interview by ID when its job and application belong to another employer', async () => {
  const employerBInterview = {
    id: interviewId,
    employerId: otherEmployerId,
    applicationId: '88888888-8888-4888-8888-888888888888',
    jobId: '99999999-9999-4999-8999-999999999999',
  };
  mockPrisma.interview.findFirst.mockImplementation(async ({ where }) =>
    where.employerId === employerBInterview.employerId ? employerBInterview : null);

  const response = await request(app)
    .get(`/api/employer/interviews/${interviewId}`)
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

  expect(response.status).toBe(404);
  expect(mockPrisma.interview.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: interviewId, employerId },
  }));
});

test('seeker cannot view an interview belonging to another seeker', async () => {
  const seekerBInterview = {
    id: interviewId,
    seekerId: otherSeekerId,
  };
  mockPrisma.interview.findFirst.mockImplementation(async ({ where }) =>
    where.seekerId === seekerBInterview.seekerId ? seekerBInterview : null);

  const response = await request(app)
    .get(`/api/seeker/interviews/${interviewId}`)
    .set('Authorization', `Bearer ${token('SEEKER', seekerId)}`);

  expect(response.status).toBe(404);
  expect(mockPrisma.interview.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: interviewId, seekerId },
  }));
});
