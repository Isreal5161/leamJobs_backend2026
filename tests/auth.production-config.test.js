import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const envModuleUrl = pathToFileURL(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/config/env.js',
)).href;

const validProductionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/config_test',
  JWT_SECRET: 'a-production-secret-with-at-least-32-bytes',
  JWT_ISSUER: 'https://api.example.test',
  JWT_AUDIENCE: 'leamjobs-api',
  TERMS_DOCUMENT_VERSION: '1.0',
  PRIVACY_DOCUMENT_VERSION: '1.0',
  FRONTEND_URL: 'https://frontend.example.test',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_REDIRECT_URI: '',
};

const importEnvironment = (overrides = {}) => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(envModuleUrl)})`],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...validProductionEnvironment,
        ...overrides,
      },
    },
  );
  return result;
};

test('production configuration rejects a short JWT secret', () => {
  const result = importEnvironment({ JWT_SECRET: 'too-short' });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('JWT_SECRET must be at least 32 bytes');
});

test('production configuration requires an HTTPS frontend origin', () => {
  const result = importEnvironment({ FRONTEND_URL: 'http://frontend.example.test' });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('FRONTEND_URL must be a valid HTTPS origin');
});

test('trusted proxy hops default to zero and accept an explicit hop count', () => {
  const defaultResult = importEnvironment();
  const configuredResult = importEnvironment({ TRUST_PROXY_HOPS: '1' });
  const invalidResult = importEnvironment({ TRUST_PROXY_HOPS: 'true' });

  expect(defaultResult.status).toBe(0);
  expect(configuredResult.status).toBe(0);
  expect(invalidResult.status).not.toBe(0);
  expect(invalidResult.stderr).toContain('TRUST_PROXY_HOPS must be a non-negative integer');
});
