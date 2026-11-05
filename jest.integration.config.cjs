module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.integration.test.js',
    '<rootDir>/tests/ai.load.concurrency.test.js',
  ],
  setupFiles: ['<rootDir>/tests/helpers/requireTestDatabase.cjs'],
};
