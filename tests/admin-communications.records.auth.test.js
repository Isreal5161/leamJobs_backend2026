import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'records-test-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: {}, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const token = (role) => jwt.sign({ sub: `${role.toLowerCase()}-1`, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

test('campaign records reject unauthenticated requests', async () => {
  const response = await request(app).get('/api/admin/communications/campaigns');
  expect(response.status).toBe(401);
});

test.each(['SEEKER', 'EMPLOYER'])('%s users cannot access campaign records', async (role) => {
  const response = await request(app)
    .get('/api/admin/communications/campaigns')
    .set('Authorization', `Bearer ${token(role)}`);
  expect(response.status).toBe(403);
});