// Vitest setup — runs before any test files.
// Must set DATA_SECRET before index.ts is loaded.
process.env.DATA_SECRET = 'test-secret-for-unit-tests-only-not-for-production';
