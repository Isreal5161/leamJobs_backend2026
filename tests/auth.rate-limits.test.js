import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-auth-rate-limit-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/leamjobs_test';
process.env.TERMS_DOCUMENT_VERSION = '1.0';
process.env.PRIVACY_DOCUMENT_VERSION = '1.0';

const { default: app } = await import('../src/app.js');

const post = (path, body) => request(app).post(`/api/auth${path}`).send(body);

test('password and admin login share account-and-IP limits with Retry-After', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    responses.push(await post('/login', { email: 'Admin@Example.com' }));
  }

  expect(responses.slice(0, 8).every((response) => response.status === 400)).toBe(true);
  expect(responses[8].status).toBe(429);
  expect(responses[8].headers['retry-after']).toBeTruthy();
  expect(responses[8].body).toEqual({
    success: false,
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many authentication attempts. Please try again later.',
    },
  });
});

test('registration IP limit applies even when the submitted email changes', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 21; attempt += 1) {
    responses.push(await post('/register', { email: `person-${attempt}@example.com` }));
  }

  expect(responses.slice(0, 20).every((response) => response.status === 400)).toBe(true);
  expect(responses[20].status).toBe(429);
  expect(responses[20].headers['retry-after']).toBeTruthy();
});

test('password reset request limiter counts malformed requests before validation', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    responses.push(await post('/forgot-password', { email: 'not-an-email' }));
  }

  expect(responses.slice(0, 3).every((response) => response.status === 400)).toBe(true);
  expect(responses[3].status).toBe(429);
});

test('password reset confirmation is limited by the reset token and IP', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    responses.push(await post('/reset-password', {
      token: 'a'.repeat(32),
      password: 'short',
    }));
  }

  expect(responses.slice(0, 6).every((response) => response.status === 400)).toBe(true);
  expect(responses[6].status).toBe(429);
});

test('email verification and resend limits use normalized email and IP', async () => {
  const verifyResponses = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    verifyResponses.push(await post('/verify-email', {
      email: ' Person@Example.com ',
      code: '123',
    }));
  }
  expect(verifyResponses[8].status).toBe(429);

  const resendResponses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    resendResponses.push(await post('/verify-email/resend', { email: 'not-an-email' }));
  }
  expect(resendResponses[3].status).toBe(429);
});

test('Google OAuth initiation and completion have IP and identity limits', async () => {
  const startResponses = [];
  for (let attempt = 0; attempt < 31; attempt += 1) {
    startResponses.push(await request(app).get('/api/auth/google/start?role=INVALID'));
  }
  expect(startResponses[30].status).toBe(429);

  const completionResponses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    completionResponses.push(await post('/google/complete', {}));
  }
  expect(completionResponses[5].status).toBe(429);
});
