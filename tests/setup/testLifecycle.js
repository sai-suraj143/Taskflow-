// jest "setupFilesAfterEnv" entry: the framework is installed here, so global hooks
// (afterAll) are available. Registered once for the whole run instead of being repeated
// in every suite file.

afterAll(async () => {
  // src/lib/prisma.js and src/lib/redis.js both attach their singletons to globalThis,
  // so closing them here is what lets the jest worker process exit instead of hanging on
  // an open TCP socket / Redis connection. These are the SAME instances the app under
  // test used — no second client is constructed just to close it.
  //
  // Deliberately no console.log silencing here: morgan writes straight to
  // process.stdout (so overriding console.log never muted it anyway) and doing so also
  // swallowed jest's own PASS/per-test reporter output. Request logs stay visible.
  const [{ prisma }, { redis }] = await Promise.all([
    import('../../src/lib/prisma.js'),
    import('../../src/lib/redis.js'),
  ]);

  await prisma.$disconnect();
  await redis.quit();
});