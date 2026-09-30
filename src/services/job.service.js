import prisma from '../lib/prisma.js';
import { enqueueJob } from '../queues/jobQueue.js';
import { removeFromDeadLetterQueue } from '../queues/deadLetterQueue.js';
import { MANUAL_RETRY_BUDGET } from '../constants/retry.js';

const createServiceError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

// True only if this Prisma error is a unique-constraint violation on exactly the
// @@unique([userId, idempotencyKey]) constraint.
//
// P2002 alone is NOT enough to conclude "idempotent replay": the schema has other
// unique constraints (User.email, JobAttempt [jobId, attemptNumber], and the Job
// primary key), and a P2002 on any of those must keep propagating as a real error
// rather than being misreported as a harmless replay.
//
// Prisma reports the violated columns in error.meta.target as an array of column
// names (e.g. ["userId", "idempotencyKey"]). Both columns are required so a future
// constraint that covers only one of them can never be mistaken for this one. The
// field is normalised defensively because some drivers report it as a plain string.
const isIdempotencyConflict = (error) => {
  if (!error || error.code !== 'P2002') {
    return false;
  }

  const { target } = error.meta ?? {};
  const columns = Array.isArray(target) ? target : [target];

  return columns.includes('userId') && columns.includes('idempotencyKey');
};

export const createJob = async ({ userId, type, payload, priority, idempotencyKey }) => {
  // Idempotency is opt-in per request. When no key is supplied the create is
  // completely unchanged from the pre-idempotency behaviour.
  const hasIdempotencyKey =
    idempotencyKey !== undefined && idempotencyKey !== null && idempotencyKey !== '';

  let job;

  if (!hasIdempotencyKey) {
    job = await prisma.job.create({
      data: {
        userId,
        type,
        payload,
        ...(priority ? { priority } : {}),
      },
    });
  } else {
    // INSERT-then-catch, deliberately not check-then-insert.
    //
    // The obvious implementation is to SELECT for an existing (userId, idempotencyKey)
    // row first and only INSERT if none is found. That has a race: two concurrent
    // requests with the same key can both run the SELECT, both observe "no row", and
    // both proceed to INSERT. The database then has to arbitrate, and one client gets
    // a raw unique-constraint error it has no idea how to interpret.
    //
    // This way the INSERT itself is the claim. Postgres serialises the two inserts on
    // the unique index, exactly one wins, and the loser is told precisely why it lost
    // (P2002 on this constraint) instead of having to guess. The race is closed by the
    // database rather than by a check that is stale by the time it is acted on.
    try {
      job = await prisma.job.create({
        data: {
          userId,
          type,
          payload,
          ...(priority ? { priority } : {}),
          idempotencyKey,
        },
      });
    } catch (error) {
      if (!isIdempotencyConflict(error)) {
        // Not a duplicate key (or a P2002 on some unrelated constraint such as a
        // different unique index). Rethrow untouched: swallowing a real database
        // failure here would report a phantom "replay" and hide the actual error.
        throw error;
      }

      // The row exists, so either this is a genuine replay of an earlier request or a
      // concurrent request that won the insert race. Both cases are answered with the
      // one canonical job, so the client always converges on a single id.
      const existingJob = await prisma.job.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });

      if (!existingJob) {
        // The conflicting row vanished between the failed insert and this read. That
        // should be practically impossible under normal operation, so rather than
        // returning a null job to the controller, surface the original database error.
        throw error;
      }

      return { job: existingJob, isReplay: true };
    }
  }

  // Known limitation for this milestone: if this enqueue fails, the job row is already
  // committed in Postgres and stays QUEUED forever with no worker ever notified. A proper
  // fix (outbox pattern / reconciliation sweep) is deferred to a future milestone and is
  // deliberately NOT implemented here, so this failure is reported loudly instead.
  try {
    await enqueueJob({
      jobId: job.id,
      remainingAttempts: job.maxAttempts,
      priority: job.priority,
    });
  } catch (err) {
    console.error(
      `[CRITICAL] Job ${job.id} created in DB but failed to enqueue:`,
      err
    );
  }

  // Only reachable when this request was the one that created the row: a replay
  // returned earlier, above.
  return { job, isReplay: false };
};

export const listJobs = async ({ userId, role, page, limit }) => {
  const where = role === 'ADMIN' ? {} : { userId };

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.job.count({ where }),
  ]);

  return { jobs, total, page, limit };
};

const fetchOwnedJob = async ({ jobId, userId, role }) => {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job || (job.userId !== userId && role !== 'ADMIN')) {
    throw createServiceError('Job not found', 404);
  }

  return job;
};

export const getJobById = ({ jobId, userId, role }) => {
  return fetchOwnedJob({ jobId, userId, role });
};

export const cancelJob = async ({ jobId, userId, role }) => {
  await fetchOwnedJob({ jobId, userId, role });

  // Compare-and-set instead of read-then-update. The status check above is only a
  // fast pre-flight: between that read and this write a worker can claim the job
  // (updateMany on status QUEUED) and move it to PROCESSING. By putting the
  // precondition in the WHERE clause, the two writes are ordered by Postgres and only
  // one can win — if the worker claimed it first, count is 0 and the cancel is
  // rejected instead of overwriting a job that is already running.
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'CANCELLED' },
  });

  if (count === 0) {
    throw createServiceError('Only jobs in QUEUED status can be cancelled', 409);
  }

  return prisma.job.findUnique({ where: { id: jobId } });
};

export const getJobAttempts = async ({ jobId, userId, role }) => {
  // Reuse the same ownership rule as getJobById so attempt history is never more
  // visible than the job it belongs to.
  await fetchOwnedJob({ jobId, userId, role });

  return prisma.jobAttempt.findMany({
    where: { jobId },
    orderBy: { attemptNumber: 'asc' },
  });
};

export const retryJob = async ({ jobId, userId, role }) => {
  await fetchOwnedJob({ jobId, userId, role });

  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (job.status !== 'FAILED') {
    throw createServiceError('Only jobs in FAILED status can be retried', 409);
  }

  // Same compare-and-set pattern as cancelJob: FAILED is the only accepted source
  // state, so two concurrent retries cannot both consume a retry budget.
  //
  // attempts is deliberately NOT reset. JobAttempt has a
  // @@unique([jobId, attemptNumber]) constraint, so zeroing the counter would make
  // the next attempt collide with an existing row (P2002) and abort the retry.
  // Instead the budget is added to maxAttempts and the counter keeps climbing, so a
  // job that died at 3/3 continues as attempts 4, 5, 6.
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: 'FAILED' },
    data: {
      status: 'QUEUED',
      failedAt: null,
      errorMessage: null,
      maxAttempts: { increment: MANUAL_RETRY_BUDGET },
    },
  });

  if (count === 0) {
    throw createServiceError('Only jobs in FAILED status can be retried', 409);
  }

  const retriedJob = await prisma.job.findUnique({ where: { id: jobId } });

  // The job is no longer dead, so its DLQ entry is stale. This is best-effort: the DLQ
  // is an inspection aid, not a source of truth, and a leftover entry is harmless
  // (nothing consumes the queue), so it must never fail the user's retry.
  try {
    await removeFromDeadLetterQueue({ jobId, attempts: retriedJob.attempts });
  } catch (err) {
    console.warn(
      `[DLQ] Job ${jobId} retried but its dead-letter entry could not be removed:`,
      err.message
    );
  }

  // Known limitation for this milestone: if this enqueue fails, the job row is already
  // committed as QUEUED and no worker will ever pick it up, because the previous
  // delivery has already been moved to a terminal state in BullMQ. A proper fix (outbox
  // pattern / reconciliation sweep) is deferred to a future milestone and is
  // deliberately NOT implemented here, so this failure is reported loudly instead.
  try {
    await enqueueJob({
      jobId,
      remainingAttempts: retriedJob.maxAttempts - retriedJob.attempts,
      priority: retriedJob.priority,
    });
  } catch (err) {
    console.error(
      `[CRITICAL] Job ${jobId} retried in DB but failed to enqueue:`,
      err
    );
  }

  return retriedJob;
};
