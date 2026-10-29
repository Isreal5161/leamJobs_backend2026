import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  siteContent: { findMany: jest.fn(), upsert: jest.fn() },
};
const mockStorage = {
  createObjectKey: jest.fn(() => 'site-content/about/team/11111111-1111-4111-8111-111111111111.jpeg'),
  uploadObject: jest.fn(),
  readObject: jest.fn(),
  deleteObject: jest.fn(),
};
jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/storage/storage.service.js', () => mockStorage);
const { default: app } = await import('../src/app.js');
const { ensureDefaultSiteContent } = await import('../src/services/siteContent.service.js');

const adminId = '99999999-9999-4999-8999-999999999999';
const seekerId = '33333333-3333-4333-8333-333333333333';
const token = (role, subject) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) => ({
    isActive: true,
    role: where.id === adminId ? 'ADMIN' : 'SEEKER',
  }));
  mockPrisma.siteContent.findMany.mockResolvedValue([]);
  mockPrisma.siteContent.upsert.mockResolvedValue({ pageKey: 'welcome', content: { heroTitle: 'Updated' }, updatedAt: new Date() });
  mockStorage.uploadObject.mockResolvedValue({});
  mockStorage.readObject.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
});

test('public content can be read without exposing private data', async () => {
  mockPrisma.siteContent.findMany.mockResolvedValue([{ pageKey: 'welcome', content: { heroTitle: 'Live' } }]);
  const response = await request(app).get('/api/content');
  expect(response.status).toBe(200);
  expect(response.body.data.content).toEqual({ welcome: { heroTitle: 'Live' } });
});

test('public content read keeps saved About team images and partner destination', async () => {
  const about = {
    team: ['SA'],
    teamImages: ['https://leamjobs.com/api/content/about/team-images/photo.jpeg'],
    partnerUrl: 'https://partners.example.org/join',
  };
  mockPrisma.siteContent.findMany.mockResolvedValue([{ pageKey: 'about', content: about }]);

  const response = await request(app).get('/api/content');

  expect(response.status).toBe(200);
  expect(response.body.data.content.about).toEqual(about);
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

test.each(['/companies?type=partner', 'https://partners.example.org/join'])('admins can save a safe About partner destination: %s', async (partnerUrl) => {
  const content = { partnerUrl, team: ['SA'], teamImages: ['/api/content/about/team-images/photo.jpeg'] };
  const response = await request(app)
    .put('/api/admin/content')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .send({ pageKey: 'about', content });

  expect(response.status).toBe(200);
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { pageKey: 'about' },
    update: { content },
  }));
});

test.each(['javascript:alert(1)', '//evil.example', 'http://partners.example.org', 'data:text/html,hello'])('admins cannot save unsafe About partner destination: %s', async (partnerUrl) => {
  const response = await request(app)
    .put('/api/admin/content')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .send({ pageKey: 'about', content: { partnerUrl } });

  expect(response.status).toBe(400);
  expect(mockPrisma.siteContent.upsert).not.toHaveBeenCalled();
});

test('team photograph upload requires an admin and stores validated image bytes outside page content', async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const unauthorized = await request(app)
    .post('/api/admin/content/about/team-images')
    .attach('image', image, { filename: 'team.jpg', contentType: 'image/jpeg' });
  expect(unauthorized.status).toBe(401);
  expect(mockStorage.uploadObject).not.toHaveBeenCalled();

  const response = await request(app)
    .post('/api/admin/content/about/team-images')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .attach('image', image, { filename: 'team.jpg', contentType: 'image/jpeg' });

  expect(response.status).toBe(201);
  expect(response.body.data.imageUrl).toBe('/api/content/about/team-images/11111111-1111-4111-8111-111111111111.jpeg');
  expect(mockStorage.createObjectKey).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'about',
    namespace: 'site-content',
    category: 'team',
    extension: 'jpeg',
  }));
  expect(mockStorage.uploadObject).toHaveBeenCalledWith(expect.objectContaining({ buffer: image }));
  expect(mockPrisma.siteContent.upsert).not.toHaveBeenCalled();

  const content = { team: ['SA'], teamImages: [response.body.data.imageUrl] };
  const saved = await request(app)
    .put('/api/admin/content')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .send({ pageKey: 'about', content });
  expect(saved.status).toBe(200);
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { pageKey: 'about' },
    update: { content },
  }));
});

test('team photograph upload rejects unsupported and falsely typed image files', async () => {
  const response = await request(app)
    .post('/api/admin/content/about/team-images')
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`)
    .attach('image', Buffer.from('not an image'), { filename: 'team.png', contentType: 'image/png' });

  expect(response.status).toBe(400);
  expect(mockStorage.uploadObject).not.toHaveBeenCalled();
});

test('public team photograph endpoint serves the stored object with an image content type', async () => {
  const response = await request(app).get('/api/content/about/team-images/11111111-1111-4111-8111-111111111111.jpeg');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/image\/jpeg/);
  expect(response.headers['cache-control']).toContain('immutable');
  expect(mockStorage.readObject).toHaveBeenCalledWith('site-content/about/team/11111111-1111-4111-8111-111111111111.jpeg');
});

test('public team photograph endpoint rejects invalid object identifiers', async () => {
  const response = await request(app).get('/api/content/about/team-images/not-a-valid-image');

  expect(response.status).toBe(404);
  expect(mockStorage.readObject).not.toHaveBeenCalled();
});

test('idempotent default content seeding writes the existing public pages only', async () => {
  await ensureDefaultSiteContent();

  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledTimes(5);
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'welcome' }, create: expect.objectContaining({ pageKey: 'welcome', content: expect.objectContaining({ heroTitle: 'Find a job that actually fits you.' }) }), update: { content: expect.objectContaining({ heroTitle: 'Find a job that actually fits you.' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { pageKey: 'about' },
    create: expect.objectContaining({ pageKey: 'about', content: expect.objectContaining({ title: 'About LeamJobs', teamImages: [], partnerUrl: '/companies' }) }),
    update: { content: expect.objectContaining({ title: 'About LeamJobs', teamImages: [], partnerUrl: '/companies' }) },
  }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'features' }, create: expect.objectContaining({ pageKey: 'features' }), update: { content: expect.objectContaining({ recommendationsTitle: 'Recommended for you' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'how-it-works' }, create: expect.objectContaining({ pageKey: 'how-it-works' }), update: { content: expect.objectContaining({ heroTitle: 'How LeamJobs works' }) } }));
  expect(mockPrisma.siteContent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageKey: 'companies' }, create: expect.objectContaining({ pageKey: 'companies' }), update: { content: expect.objectContaining({ heroTitle: 'Companies on LeamJobs' }) } }));
});

test('invalid content pages are rejected', async () => {
  const response = await request(app).put('/api/admin/content').set('Authorization', `Bearer ${token('ADMIN', adminId)}`).send({ pageKey: 'unknown', content: {} });
  expect(response.status).toBe(400);
  expect(mockPrisma.siteContent.upsert).not.toHaveBeenCalled();
});
