// Jest runs the suite as native ES modules, matching package.json's "type": "module".
//
// Two settings make that work, and BOTH are required:
//   transform: {}  - disables babel-jest entirely. Without it Jest tries to
//                    require() .js files as CommonJS and every `import` fails with
//                    "Cannot use import statement outside a module".
//   NODE_OPTIONS=--experimental-vm-modules (set by the "test" script, not here)
//                  - Jest needs the VM modules API to evaluate an ESM test file.
//
// extensionsToTreatAsEsm is deliberately NOT set: with "type": "module" Jest already
// treats .js as ESM, and listing it there is redundant.
export default {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: {},
  moduleFileExtensions: ['js', 'json', 'node'],
  // Runs BEFORE the test framework and before any src/** module is imported, which is
  // what lets .env.test win: src/config/env.js calls dotenv.config() (no override), so
  // anything already in process.env is preserved.
  setupFiles: ['<rootDir>/tests/setup/loadTestEnv.js'],
  // Runs after the framework is installed, so global beforeEach/afterAll exist.
  setupFilesAfterEnv: ['<rootDir>/tests/setup/testLifecycle.js'],
  // The suite talks to a real Postgres and a real Redis over TCP; the default 5s is not
  // enough headroom for the first connection + bcrypt hashing on a cold container.
  testTimeout: 30000,
  // --runInBand is set in the "test" script rather than here, because it is REQUIRED
  // and not cosmetic: every suite shares one taskflow_test database and each suite's
  // beforeEach truncates it. Jest's default parallel workers therefore ran two suites
  // at once, and one file's cleanDatabase() deleted rows the other file had just
  // created, surfacing as a 500 (Prisma P2003 foreign-key violation on Job.userId).
  // Verified: 22-23/24 passed in parallel workers, 24/24 with --runInBand.
  verbose: true,
};