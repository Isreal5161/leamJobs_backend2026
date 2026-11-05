module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  workerIdleMemoryLimit: '512MB',
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.integration\\.test\\.js$',
    '/tests/ai\\.load\\.concurrency\\.test\\.js$',
    '/tests/[^/\\\\]*-migration\\.test\\.js$',
  ],
};
