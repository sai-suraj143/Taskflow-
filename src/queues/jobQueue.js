import { Queue } from 'bullmq';
import redis from '../lib/redis.js';

export const JOB_QUEUE_NAME = 'job-queue';

export const jobQueue = new Queue(JOB_QUEUE_NAME, {
  connection: redis,
});

export default jobQueue;
