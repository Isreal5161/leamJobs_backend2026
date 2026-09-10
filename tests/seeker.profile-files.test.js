import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.R2_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.R2_ACCESS_KEY_ID = 'test-key-id';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';

const mockPrisma = {
  seekerProfile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

// Mock the S3Client
jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn((input) => input),
  GetObjectCommand: jest.fn((input) => input),
  DeleteObjectCommand: jest.fn((input) => input),
}));

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const createToken = (role = 'SEEKER') => jwt.sign({ sub: seekerId, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ profilePictureKey: null, resumeObjectKey: null });
  mockPrisma.seekerProfile.upsert.mockResolvedValue({
    profilePictureUrl: '/api/seeker/profile/picture',
    profilePictureKey: 'picture-key',
    resumeUrl: '/api/seeker/profile/resume',
    resumeObjectKey: 'resume-key',
  });
  mockPrisma.seekerProfile.update.mockResolvedValue({});
});

describe('seeker profile file endpoints', () => {
  test('uploads a valid PDF resume for the authenticated seeker', async () => {
    const response = await request(app)
      .post('/api/seeker/profile/resume')
      .set('Authorization', `Bearer ${createToken()}`)
      .attach('file', Buffer.from('%PDF-1.7 local test'), { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(200);
    expect(response.body.data.resumeUrl).toBe('/api/seeker/profile/resume');
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: seekerId },
      update: expect.objectContaining({ resumeObjectKey: expect.stringMatching(/^seekers\/11111111-1111-4111-8111-111111111111\/resume\/[\da-f-]+\.pdf$/) }),
    }));
  });

  test.each([
    ['doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]), 'application/msword'],
    ['docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), Buffer.from('[Content_Types].xml')]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('accepts a valid %s resume', async (extension, content, contentType) => {
    const response = await request(app)
      .post('/api/seeker/profile/resume')
      .set('Authorization', `Bearer ${createToken()}`)
      .attach('file', content, { filename: `resume.${extension}`, contentType });

    expect(response.status).toBe(200);
  });

  test('rejects a mismatched resume signature', async () => {
    const response = await request(app)
      .post('/api/seeker/profile/resume')
      .set('Authorization', `Bearer ${createToken()}`)
      .attach('file', Buffer.from('not a pdf'), { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
  });

  test('uploads a valid PNG profile picture and deletes through ownership-scoped routes', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploadResponse = await request(app)
      .post('/api/seeker/profile/picture')
      .set('Authorization', `Bearer ${createToken()}`)
      .attach('file', pngHeader, { filename: 'avatar.png', contentType: 'image/png' });

    expect(uploadResponse.status).toBe(200);

    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ profilePictureKey: 'picture-key', resumeObjectKey: null });
    const deleteResponse = await request(app)
      .delete('/api/seeker/profile/picture')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(deleteResponse.status).toBe(200);
    expect(mockPrisma.seekerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: seekerId } }));
  });

  test.each(['EMPLOYER', 'ADMIN'])('forbids %s from uploading a seeker file', async (role) => {
    const response = await request(app)
      .post('/api/seeker/profile/resume')
      .set('Authorization', `Bearer ${createToken(role)}`)
      .attach('file', Buffer.from('%PDF-1.7 local test'), { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(403);
  });

  test('requires authentication for profile file endpoints', async () => {
    const response = await request(app)
      .post('/api/seeker/profile/resume')
      .attach('file', Buffer.from('%PDF-1.7 local test'), { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(401);
  });
});
