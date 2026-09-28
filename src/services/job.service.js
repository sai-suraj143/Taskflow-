import prisma from '../lib/prisma.js';
import { enqueueJob } from '../queues/jobQueue.js';
import { removeFromDeadLetterQueue } from '../queues/deadLetterQueue.js';
import { MANUAL_RETRY_BUDGET } from '../constants/retry.js';

const createServiceError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export const createJob = async ({ userId, type, payload, priority }) => {
  const job = await prisma.job.create({
    data: {
      userId,
      type,
      payload,
      ...(priority ? { priority } : {}),
    },
  });

  // Known limitation for this milestone: if this enqueue fails, the job row is already
  // committed in Postgres and stays QUEUED forever with no worker ever notified. A proper
  // fix (outbox pattern / reconciliation sweep) is deferred to a future milestone and is
  // deliberately NOT implemented here, so this failure is reported loudly instead.
  try {
    await enqueueJob({ jobId: job.id, remainingAttempts: job.maxAttempts });
  } catch (err) {
    console.error(
      `[CRITICAL] Job ${job.id} created in DB but failed to enqueue:`,
      err
    );
  }

  return job;
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
    });
  } catch (err) {
    console.error(
      `[CRITICAL] Job ${jobId} retried in DB but failed to enqueue:`,
      err
    );
  }

  return retriedJob;
};
