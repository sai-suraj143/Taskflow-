import { Worker } from 'bullmq';
import config from './config/env.js';
import { createBullMqConnection } from './lib/redis.js';
import { JOB_QUEUE_NAME } from './queues/jobQueue.js';
import { executeJob } from './services/jobExecution.service.js';

const CONCURRENCY = 5;

const connection = createBullMqConnection();

const worker = new Worker(
  JOB_QUEUE_NAME,
  async (job) => executeJob({ jobId: job.data.jobId }),
  { connection, concurrency: CONCURRENCY }
);

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
  `Worker started, listening on queue '${JOB_QUEUE_NAME}' with concurrency ${CONCURRENCY} (env: ${config.nodeEnv})`
);
