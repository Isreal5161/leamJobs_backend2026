import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'image-test-secret';
process.env.JWT_ISSUER = 'image-test-issuer';
process.env.JWT_AUDIENCE = 'image-test-audience';

const employerId = '11111111-1111-4111-8111-111111111111';
const otherEmployerId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockPrisma = {
  employerProfile: { findUnique: jest.fn() },
  application: { findFirst: jest.fn() },
  job: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
};
const mockReadObject = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/storage/storage.service.js', () => ({
  readObject: mockReadObject,
  createObjectKey: jest.fn(),
  uploadObject: jest.fn(),
  deleteObject: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const token = (role, sub) => jwt.sign({ sub, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

afterEach(() => jest.clearAllMocks());

test('public company logo streams without authentication and never accepts an object key', async () => {
  mockPrisma.employerProfile.findUnique.mockResolvedValue({ companyLogoKey: 'employers/111/logo.png' });
  mockReadObject.mockResolvedValue(Buffer.from('logo'));

  const response = await request(app).get(`/api/public/companies/${employerId}/logo`);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/image\/png/);
  expect(response.body.toString()).toBe('logo');
  expect(mockReadObject).toHaveBeenCalledWith('employers/111/logo.png');
  expect(mockPrisma.employerProfile.findUnique).toHaveBeenCalledWith({
    where: { userId: employerId },
    select: { companyLogoKey: true },
  });
});

test('missing public company logo returns 404', async () => {
  mockPrisma.employerProfile.findUnique.mockResolvedValue({ companyLogoKey: null });

  const response = await request(app).get(`/api/public/companies/${employerId}/logo`);

  expect(response.status).toBe(404);
  expect(mockReadObject).not.toHaveBeenCalled();
});

test('owning employer can stream an applicant profile picture but another employer cannot', async () => {
  mockPrisma.application.findFirst.mockResolvedValue({
    seeker: { seekerProfile: { profilePictureKey: 'seekers/seeker-1/profile-picture/a.png' } },
  });
  mockReadObject.mockResolvedValue(Buffer.from('picture'));

  const allowed = await request(app)
    .get(`/api/employer/jobs/${jobId}/applications/${applicationId}/profile-picture`)
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

  expect(allowed.status).toBe(200);
  expect(allowed.headers['content-type']).toMatch(/image\/png/);
  expect(allowed.body.toString()).toBe('picture');

  mockPrisma.application.findFirst.mockResolvedValue(null);
  const denied = await request(app)
    .get(`/api/employer/jobs/${jobId}/applications/${applicationId}/profile-picture`)
    .set('Authorization', `Bearer ${token('EMPLOYER', otherEmployerId)}`);

  expect(denied.status).toBe(404);
});

test('admin profile-picture access remains scoped to authorized jobs', async () => {
  mockPrisma.job.findUnique.mockResolvedValue({ id: jobId, employerId });
  mockPrisma.user.findUnique.mockResolvedValue({ id: employerId, role: 'EMPLOYER', employerProfile: { companyName: 'LeamJobs' } });
  mockPrisma.application.findFirst.mockResolvedValue({
    seeker: { seekerProfile: { profilePictureKey: 'seekers/seeker-1/profile-picture/a.webp' } },
  });
  mockReadObject.mockResolvedValue(Buffer.from('picture'));

  const response = await request(app)
    .get(`/api/admin/jobs/${jobId}/applications/${applicationId}/profile-picture`)
    .set('Authorization', `Bearer ${token('ADMIN', adminId)}`);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/image\/webp/);
});

test('missing applicant profile picture returns 404 without reading storage', async () => {
  mockPrisma.application.findFirst.mockResolvedValue({ seeker: { seekerProfile: { profilePictureKey: null } } });

  const response = await request(app)
    .get(`/api/employer/jobs/${jobId}/applications/${applicationId}/profile-picture`)
    .set('Authorization', `Bearer ${token('EMPLOYER', employerId)}`);

  expect(response.status).toBe(404);
  expect(mockReadObject).not.toHaveBeenCalled();
});
