import safety from './helpers/testDatabaseSafety.cjs';

const { validateTestDatabaseEnvironment } = safety;

describe('test database safety', () => {
  test('requires an explicit TEST_DATABASE_URL', () => {
    expect(() => validateTestDatabaseEnvironment({})).toThrow('TEST_DATABASE_URL is required');
  });

  test('rejects invalid and non-PostgreSQL URLs without exposing the URL', () => {
    const invalidUrl = 'not-a-url-with-secret-password';
    const nonPostgresUrl = 'https://test:secret-password@localhost/test_db';

    for (const testDatabaseUrl of [invalidUrl, nonPostgresUrl]) {
      let error;
      try {
        validateTestDatabaseEnvironment({ TEST_DATABASE_URL: testDatabaseUrl });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain(testDatabaseUrl);
      expect(error.message).not.toContain('secret-password');
    }
  });

  test('rejects remote PostgreSQL hosts', () => {
    expect(() => validateTestDatabaseEnvironment({
      TEST_DATABASE_URL: 'postgresql://test:secret@db.example.test:5432/leamjobs_test',
    })).toThrow('loopback database host');
  });

  test('rejects database names without a clear test identifier', () => {
    expect(() => validateTestDatabaseEnvironment({
      TEST_DATABASE_URL: 'postgresql://test:secret@localhost:5432/leamjobs_dev',
    })).toThrow('clearly identify a non-production test database');
  });

  test('rejects a target that collides with configured DATABASE_URL', () => {
    const target = 'postgresql://test:secret@localhost:5432/leamjobs_test?schema=public';

    expect(() => validateTestDatabaseEnvironment({
      TEST_DATABASE_URL: target,
      DATABASE_URL: 'postgresql://prod:other-secret@localhost:5432/leamjobs_test?schema=public',
    })).toThrow('must not target the configured DATABASE_URL');
  });

  test('accepts a distinct localhost test database', () => {
    const testDatabaseUrl = 'postgresql://test:secret@127.0.0.1:5432/leamjobs_test';

    expect(validateTestDatabaseEnvironment({
      TEST_DATABASE_URL: testDatabaseUrl,
      DATABASE_URL: 'postgresql://app:secret@localhost:5432/leamjobs_production',
    })).toBe(testDatabaseUrl);
  });

  test('uses generic errors without exposing credentials or full connection strings', () => {
    const testDatabaseUrl = 'postgresql://test:very-secret-password@remote.example/leamjobs_dev';

    let error;
    try {
      validateTestDatabaseEnvironment({ TEST_DATABASE_URL: testDatabaseUrl });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('very-secret-password');
    expect(error.message).not.toContain(testDatabaseUrl);
    expect(error.message).not.toMatch(/postgres(?:ql)?:\/\//i);
  });
});
