import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// tests/setup/loadTestEnv.js is a jest "setupFiles" entry, so it executes before the
// test framework installs AND before any test file imports src/**. That ordering is the
// whole mechanism: src/config/env.js calls dotenv.config() with default options, which
// never overwrites a variable that already exists in process.env. Loading .env.test here
// therefore wins over .env, even though .env is loaded later.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.test');

dotenv.config({ path: envPath });

// Hard guard, not a convenience: if DATABASE_URL ever ends up pointing at the
// development database (or is missing entirely), every test below would happily
// truncate and recreate real Day 1-8 data via cleanDatabase(). Fail loudly instead.
const databaseUrl = process.env.DATABASE_URL ?? '';

if (!databaseUrl.includes('taskflow_test')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL is "${databaseUrl}", expected it to contain "taskflow_test". ` +
      'Is .env.test present and loaded?'
  );
}