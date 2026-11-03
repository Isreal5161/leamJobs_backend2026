import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-auth-security-config-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/leamjobs_test';
process.env.TERMS_DOCUMENT_VERSION = '1.0';
process.env.PRIVACY_DOCUMENT_VERSION = '1.0';
process.env.FRONTEND_URL = 'https://frontend.example.test/';
process.env.FRONTEND_URL_PROD = 'https://www.frontend.example.test';
process.env.TRUST_PROXY_HOPS = '0';

const { default: app } = await import('../src/app.js');

test('trusted proxy defaults to disabled until deployment topology is confirmed', () => {
  expect(app.get('trust proxy')).toBe(0);
});

test('CORS allows configured frontend origins with credentials', async () => {
  const response = await request(app)
    .get('/health')
    .set('Origin', 'https://frontend.example.test');

  expect(response.status).toBe(200);
  expect(response.headers['access-control-allow-origin']).toBe('https://frontend.example.test');
  expect(response.headers['access-control-allow-credentials']).toBe('true');
});

test('CORS does not grant credentials to arbitrary origins', async () => {
  const response = await request(app)
    .get('/health')
    .set('Origin', 'https://attacker.example');

  expect(response.status).toBe(200);
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
});
