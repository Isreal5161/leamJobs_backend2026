import { jest } from '@jest/globals';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  job: { findMany: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

beforeEach(() => jest.clearAllMocks());

describe('Public job sitemap', () => {
  test('returns valid XML containing only approved job detail URLs', async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);

    const response = await request(app).get('/api/jobs/sitemap.xml');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/xml/);
    expect(response.headers['cache-control']).toContain('public');
    expect(response.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(response.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(response.text).toContain('https://leamjobs.com/jobs/11111111-1111-4111-8111-111111111111');
    expect(response.text).toContain('https://leamjobs.com/jobs/22222222-2222-4222-8222-222222222222');
    expect(response.text).not.toContain('<html');
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
      where: { status: 'APPROVED' },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: 50000,
    });
  });

  test('returns an empty, valid sitemap if there are no approved jobs', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/jobs/sitemap.xml');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(response.text).toContain('</urlset>');
    expect(response.text).not.toContain('<url>');
  });
});
