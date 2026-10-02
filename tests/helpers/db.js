import prisma from '../../src/lib/prisma.js';

// Reuses src/lib/prisma.js on purpose. That module caches its client on globalThis, so
// the test file, the app under test and this helper all share ONE connection pool
// against taskflow_test. A second `new PrismaClient()` here would open a second pool to
// the same database and make teardown bookkeeping wrong.

// Child rows first, always in FK-safe order:
//   JobAttempt.jobId -> Job.id   (onDelete: Cascade, but cascade is not relied on)
//   Job.userId       -> User.id  (onDelete: Restrict — a User delete FAILS while it
//                                        still owns jobs, so Job must go first)
export const cleanDatabase = async () => {
  await prisma.jobAttempt.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
};

export default cleanDatabase;