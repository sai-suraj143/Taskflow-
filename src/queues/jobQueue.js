import { Queue } from 'bullmq';
import redis from '../lib/redis.js';
import config from '../config/env.js';

export const JOB_QUEUE_NAME = 'job-queue';

export const jobQueue = new Queue(JOB_QUEUE_NAME, {
  connection: redis,
});

// The single enqueue path for work, used by both job creation and manual retry.
//
// The payload stays exactly { jobId }: the queue message is only a pointer, and
// Postgres remains the single source of truth for what a job is, which attempt it
// is on, and how many attempts it has left. Carrying richer state here would create
// two sources of truth that can drift.
//
// remainingAttempts is derived from Postgres (maxAttempts - attempts) by the caller
// and is what BullMQ uses for its own redelivery budget. The decision of whether a
// failure is final is made against job.attempts vs job.maxAttempts in Postgres, not
// against BullMQ's attemptsMade counter — BullMQ only owns timing and redelivery.
//
// Backoff is attached here, at enqueue time, by the producer, so the worker needs
// no knowledge of the backoff strategy. "exponential" means the nth retry waits
// delay * 2^(n-1). Known limitation: this built-in strategy applies no jitter, so
// many jobs failing together will retry in lockstep.
export async function enqueueJob({ jobId, remainingAttempts }) {
  if (!Number.isInteger(remainingAttempts) || remainingAttempts < 1) {
    throw new Error(
      `enqueueJob requires remainingAttempts >= 1, received ${remainingAttempts} for job ${jobId}`
    );
  }

  return jobQueue.add(
    'process-job',
    { jobId },
    {
      attempts: remainingAttempts,
      backoff: { type: 'exponential', delay: config.retryBackoffBaseMs },
    }
  );
}

export default jobQueue;
