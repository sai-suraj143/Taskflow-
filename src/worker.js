import { Worker, UnrecoverableError } from 'bullmq';
import config from './config/env.js';
import { createBullMqConnection } from './lib/redis.js';
import { JOB_QUEUE_NAME } from './queues/jobQueue.js';
import { executeJob } from './services/jobExecution.service.js';

const CONCURRENCY = 5;

const connection = createBullMqConnection();

// executeJob is pure with respect to BullMQ: it decides what happened in Postgres and
// returns an outcome. Translating that into BullMQ's vocabulary happens here, so the
// retry policy lives with the queue and the service stays queue-agnostic.
const processQueueJob = async (queueJob) => {
  const result = await executeJob({ jobId: queueJob.data.jobId });

  switch (result.outcome) {
    case 'RETRY_SCHEDULED':
      // A normal Error tells BullMQ the delivery failed and to redeliver it according
      // to the exponential backoff attached at enqueue time. Postgres already recorded
      // the attempt and the re-queue, so BullMQ only owns the timing.
      throw new Error(result.message);

    case 'DEAD':
      // UnrecoverableError tells BullMQ to stop redelivering and park the message.
      // Postgres has already declared the job terminally FAILED, so further attempts
      // would only re-run a job that has no attempts left.
      throw new UnrecoverableError(result.message);

    default:
      // COMPLETED, and SKIPPED (duplicate/stale delivery) which must be acknowledged
      // rather than retried, otherwise BullMQ would keep redelivering a message that
      // can never become claimable.
      return result;
  }
};

const worker = new Worker(JOB_QUEUE_NAME, processQueueJob, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on('completed', (job) => {
  console.log(`[WORKER] Queue job ${job.id} (taskflow job ${job.data.jobId}) completed`);
});

worker.on('failed', (job, error) => {
  console.error(
    `[WORKER] Queue job ${job?.id ?? 'unknown'} (taskflow job ${job?.data?.jobId ?? 'unknown'}) failed: ${error.message}`
  );
});

worker.on('error', (error) => {
  console.error('[WORKER] Worker error:', error.message);
});

console.log(
  `Worker started, listening on queue '${JOB_QUEUE_NAME}' with concurrency ${CONCURRENCY}, base backoff ${config.retryBackoffBaseMs}ms (env: ${config.nodeEnv})`
);
