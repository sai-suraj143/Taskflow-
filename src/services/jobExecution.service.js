import prisma from '../lib/prisma.js';
import config from '../config/env.js';
import { getHandler } from '../handlers/index.js';
import { addToDeadLetterQueue } from '../queues/deadLetterQueue.js';

const FORCE_FAIL_MESSAGE = 'Simulated failure: forceFail flag set';

// Every Prisma call is funnelled through here so a database failure is logged as a
// distinct category ([DB ERROR]) from a job-handler failure ([HANDLER ERROR]), and
// keeps the operation that failed in the log line. The error is re-thrown so BullMQ
// records the queue message as failed instead of silently acknowledging it.
//
// This module has NO BullMQ dependency on purpose: it decides *what* happened to a job
// in Postgres and returns an outcome object. The worker translates that outcome into
// the appropriate BullMQ signal (throw / UnrecoverableError / return), so retry
// semantics stay in one place and this service stays reusable and testable.
const runDbWrite = async (label, operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error(`[DB ERROR] ${label} failed: ${error.message}`, error);
    throw error;
  }
};

// Test-only failure injection, applied once here at the execution boundary instead of
// being duplicated inside each handler. It is a single seam for exercising the retry /
// backoff / dead-letter path without writing a handler that always throws.
//
// Honored ONLY when NODE_ENV !== 'production': these flags are attacker-controllable
// input (they arrive inside the job payload, which clients supply), so honoring them
// in production would let any user force arbitrary failures.
const applyTestHooks = (payload, attemptNumber) => {
  if (config.nodeEnv === 'production') {
    return;
  }

  if (typeof payload === 'object' && payload !== null && payload.forceFail === true) {
    throw new Error(FORCE_FAIL_MESSAGE);
  }

  if (
    Number.isInteger(payload?.failUntilAttempt) &&
    attemptNumber < payload.failUntilAttempt
  ) {
    throw new Error(
      `Simulated failure: attempt ${attemptNumber} < failUntilAttempt ${payload.failUntilAttempt}`
    );
  }
};

// Claim the job and open its attempt row in a single transaction.
//
// This is a compare-and-set: the status check lives in the WHERE clause, so Postgres
// serialises the competing writes. A read-then-update claim would let two workers both
// observe QUEUED (queue redelivery, or a stalled job being picked up again) and both
// increment attempts, double-counting the attempt and colliding on the
// @@unique([jobId, attemptNumber]) constraint.
const claimJob = async (jobId) => {
  const startedAt = new Date();

  return runDbWrite(`claim job ${jobId}`, () =>
    prisma.$transaction(async (tx) => {
      const claim = await tx.job.updateMany({
        where: { id: jobId, status: 'QUEUED' },
        data: { status: 'PROCESSING', startedAt, attempts: { increment: 1 } },
      });

      if (claim.count === 0) {
        // Not an error: the job is missing, CANCELLED, already COMPLETED, already
        // FAILED, or currently PROCESSING by another worker. Read the current status
        // for the log line only, then bail out without creating an attempt row and
        // without throwing, so a duplicate delivery cannot corrupt the attempt history.
        const current = await tx.job.findUnique({
          where: { id: jobId },
          select: { status: true, attempts: true },
        });

        return { claimed: false, observed: current };
      }

      // Re-read inside the transaction to get the authoritative post-increment attempts
      // value; the claim and the attempt row must both succeed or neither must.
      const job = await tx.job.findUnique({ where: { id: jobId } });
      const attemptNumber = job.attempts;

      const attempt = await tx.jobAttempt.create({
        data: { jobId, attemptNumber, status: 'PROCESSING', startedAt },
      });

      return { claimed: true, job, attempt, attemptNumber };
    })
  );
};

export const executeJob = async ({ jobId }) => {
  const claim = await claimJob(jobId);

  if (!claim.claimed) {
    const reason = claim.observed
      ? `job is ${claim.observed.status} (attempts=${claim.observed.attempts})`
      : 'job no longer exists in Postgres';

    console.log(`[SKIP] jobId=${jobId} not claimable, skipping delivery: ${reason}`);

    return { outcome: 'SKIPPED', reason };
  }

  const { job, attempt, attemptNumber } = claim;

  console.log(
    `[JOB] jobId=${jobId} type=${job.type} attempt=${attemptNumber}/${job.maxAttempts} status=PROCESSING`
  );

  let result;
  try {
    const handler = getHandler(job.type);

    applyTestHooks(job.payload, attemptNumber);

    result = await handler(job.payload);
  } catch (handlerError) {
    // Caught here, at the handler boundary (an unregistered type throws from
    // getHandler and is treated exactly like any other handler failure): the job is
    // recorded and translated into an outcome. The error is NOT re-thrown from this
    // service, so one failing job can never crash the worker process and so the
    // retry/dead decision is made from Postgres values rather than from a throw.
    return recordHandlerFailure({
      jobId,
      jobType: job.type,
      attemptId: attempt.id,
      attemptNumber,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      handlerError,
    });
  }

  const completedAt = new Date();

  await runDbWrite(`mark job ${jobId} COMPLETED`, () =>
    prisma.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt, errorMessage: null },
    })
  );
  await runDbWrite(`mark attempt ${attemptNumber} of job ${jobId} COMPLETED`, () =>
    prisma.jobAttempt.update({
      where: { id: attempt.id },
      data: { status: 'COMPLETED', completedAt },
    })
  );

  console.log(
    `[JOB] jobId=${jobId} attempt=${attemptNumber} status=COMPLETED result=${JSON.stringify(result)}`
  );

  return { outcome: 'COMPLETED' };
};

// The attempt row is closed first, so a crash between the two writes leaves a FAILED
// attempt rather than an attempt that still claims to be PROCESSING. The Job row is
// then moved to its next state.
//
// Finality is decided from Postgres values (attempts vs maxAttempts), NOT from
// BullMQ's attemptsMade counter. Those can disagree — BullMQ counts a delivery
// attempt, Postgres counts a claimed execution — and Postgres is the durable record.
const recordHandlerFailure = async ({
  jobId,
  jobType,
  attemptId,
  attemptNumber,
  attempts,
  maxAttempts,
  handlerError,
}) => {
  const errorMessage = handlerError?.message || 'Unknown error';
  const completedAt = new Date();

  await runDbWrite(`mark attempt ${attemptNumber} of job ${jobId} FAILED`, () =>
    prisma.jobAttempt.update({
      where: { id: attemptId },
      data: { status: 'FAILED', completedAt, errorMessage },
    })
  );

  if (attempts < maxAttempts) {
    // Attempts remain: the job returns to QUEUED so the worker's throw schedules the
    // redelivery with backoff. failedAt stays null because the job is not dead yet, and
    // errorMessage keeps the last failure visible while the job waits.
    await runDbWrite(`requeue job ${jobId} for another attempt`, () =>
      prisma.job.update({
        where: { id: jobId },
        data: { status: 'QUEUED', errorMessage },
      })
    );

    console.log(
      `[HANDLER ERROR] jobId=${jobId} type=${jobType} attempt=${attemptNumber}/${maxAttempts} error="${errorMessage}"`
    );
    console.log(
      `[RETRY] job ${jobId} attempt ${attemptNumber}/${maxAttempts} failed, retry scheduled`
    );

    return { outcome: 'RETRY_SCHEDULED', message: errorMessage };
  }

  // Attempts exhausted: FAILED becomes the terminal state and failedAt is finally set.
  await runDbWrite(`mark job ${jobId} FAILED`, () =>
    prisma.job.update({
      where: { id: jobId },
      data: { status: 'FAILED', failedAt: completedAt, errorMessage },
    })
  );

  console.error(
    `[HANDLER ERROR] jobId=${jobId} type=${jobType} attempt=${attemptNumber}/${maxAttempts} error="${errorMessage}"`
  );
  console.log(`[DEAD] job ${jobId} exhausted ${attemptNumber}/${maxAttempts} attempts`);

  // Dead-lettering is a notification, not the record of death. The durable record is
  // the Postgres FAILED row written above, so a DLQ failure must not change the
  // outcome or resurrect the job — it is reported loudly instead.
  try {
    await addToDeadLetterQueue({ jobId, reason: errorMessage, attempts });
  } catch (dlqError) {
    console.error(
      `[CRITICAL] Job ${jobId} marked FAILED in DB but failed to enqueue into the dead letter queue:`,
      dlqError
    );
  }

  return { outcome: 'DEAD', message: errorMessage };
};

export default executeJob;
