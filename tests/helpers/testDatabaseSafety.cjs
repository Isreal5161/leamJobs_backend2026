const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TEST_DATABASE_NAME = /(?:^|[_-])(?:test|testing|integration|disposable)(?:$|[_-])/i;
const PRODUCTION_DATABASE_NAME = /(?:^|[_-])(?:prod|production|live|primary)(?:$|[_-])/i;

const invalidTestUrl = () => new Error(
  'TEST_DATABASE_URL must be a valid PostgreSQL URL targeting a local disposable test database.',
);

const parseDatabaseTarget = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalidTestUrl();
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw invalidTestUrl();
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw invalidTestUrl();
  }

  if (!databaseName || databaseName.includes('/')) {
    throw invalidTestUrl();
  }

  return {
    hostname: url.hostname.toLowerCase(),
    port: url.port || '5432',
    databaseName,
    schema: url.searchParams.get('schema') || 'public',
  };
};

const sameDatabaseTarget = (left, right) => (
  (LOCAL_HOSTS.has(left.hostname) && LOCAL_HOSTS.has(right.hostname))
    || left.hostname === right.hostname
)
  && left.port === right.port
  && left.databaseName === right.databaseName
  && left.schema === right.schema;

const validateTestDatabaseEnvironment = (environment = process.env) => {
  const testDatabaseUrl = environment.TEST_DATABASE_URL;
  if (typeof testDatabaseUrl !== 'string' || testDatabaseUrl.trim() === '') {
    throw new Error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
  }

  const testTarget = parseDatabaseTarget(testDatabaseUrl);
  if (!LOCAL_HOSTS.has(testTarget.hostname)) {
    throw new Error('TEST_DATABASE_URL must use a loopback database host.');
  }
  if (!TEST_DATABASE_NAME.test(testTarget.databaseName)
    || PRODUCTION_DATABASE_NAME.test(testTarget.databaseName)) {
    throw new Error('TEST_DATABASE_URL database name must clearly identify a non-production test database.');
  }

  const productionDatabaseUrl = environment.DATABASE_URL;
  if (typeof productionDatabaseUrl === 'string' && productionDatabaseUrl.trim() !== '') {
    let productionTarget;
    try {
      productionTarget = parseDatabaseTarget(productionDatabaseUrl);
    } catch {
      throw new Error('DATABASE_URL is invalid; refusing to run PostgreSQL integration tests.');
    }

    if (sameDatabaseTarget(testTarget, productionTarget)) {
      throw new Error('TEST_DATABASE_URL must not target the configured DATABASE_URL database.');
    }
  }

  return testDatabaseUrl;
};

const configureTestDatabase = (environment = process.env) => {
  const testDatabaseUrl = validateTestDatabaseEnvironment(environment);
  environment.DATABASE_URL = testDatabaseUrl;
  return testDatabaseUrl;
};

module.exports = {
  configureTestDatabase,
  validateTestDatabaseEnvironment,
};
