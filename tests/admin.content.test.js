import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = { siteContent: { findMany: jest.fn(), upsert: jest.fn() } };
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
const { default: app } = await import('../src/app.js');
const { ensureDefaultSiteContent } = await import('../src/services/siteContent.service.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.siteContent.findMany.mockResolvedValue([]);
  mockPrisma.siteContent.upsert.mockResolvedValue({ pageKey: 'welcome', content: { heroTitle: 'Updated' }, updatedAt: new Date() });
});

test('public content can be read without exposing private data', async () => {
  mockPrisma.siteContent.findMany.mockResolvedValue([{ pageKey: 'welcome', content: { heroTitle: 'Live' } }]);
  const response = await request(app).get('/api/content');
  expect(response.status).toBe(200);
  expect(response.body.data.content).toEqual({ welcome: { heroTitle: 'Live' } });
});

test('content mutations require ADMIN', async () => {
  const unauthenticated = await request(app).put('/api/admin/content').send({ pageKey: 'welcome', content: {} });
  expect(unauthenticated.status).toBe(401);
  const seeker = await request(app).put('/api/admin/content').set('Authorization', `Bearer ${token('SEEKER', seekerId)}`).send({ pageKey: 'welcome', content: {} });
  expect(seeker.status).toBe(403);
  expect(mockPrisma.siteContent.upsert).not.toHaveBeenCalled();
});

test('admins can update a validated content page', async () => {
  const response = await request(app).put('/api/admin/content').set('Authorization', `Bearer ${token('ADMIN', adminId)}`).send({ pageKey: 'welcome', content: { heroTitle: 'Updated' } });
  expect(response.status).toBe(200);
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'welcome' }, create: { pageKey: 'welcome', content: { heroTitle: 'Updated' } }, update: { content: { heroTitle: 'Updated' } } }));
});

test('idempotent default content seeding writes the existing public pages only', async () => {
  await ensureDefaultSiteContent();

  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledTimes(5);
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'welcome' }, create: expect.objectContaining({ pageKey: 'welcome', content: expect.objectContaining({ heroTitle: 'Find a job that actually fits you.' }) }), update: { content: expect.objectContaining({ heroTitle: 'Find a job that actually fits you.' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'about' }, create: expect.objectContaining({ pageKey: 'about' }), update: { content: expect.objectContaining({ title: 'About LeamJobs' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'features' }, create: expect.objectContaining({ pageKey: 'features' }), update: { content: expect.objectContaining({ recommendationsTitle: 'Recommended for you' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'how-it-works' }, create: expect.objectContaining({ pageKey: 'how-it-works' }), update: { content: expect.objectContaining({ heroTitle: 'How LeamJobs works' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'companies' }, create: expect.objectContaining({ pageKey: 'companies' }), update: { content: expect.objectContaining({ heroTitle: 'Companies on LeamJobs' }) } }));
});

test('invalid content pages are rejected', async () => {
  const response = await request(app).put('/api/admin/content').set('Authorization', `Bearer ${token('ADMIN', adminId)}`).send({ pageKey: 'unknown', content: {} });
  expect(response.status).toBe(400);
  expect(mockPrisma.siteContent.upsert).not.toHaveBeenCalled();
});
