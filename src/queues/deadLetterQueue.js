import { Queue } from 'bullmq';
import redis from '../lib/redis.js';

export const DLQ_QUEUE_NAME = 'job-dlq';

// The Dead Letter Queue. Jobs land here once Postgres has declared them terminally
// FAILED (attempts exhausted), so the set of dead jobs can be inspected or drained by
// a human/tooling.
//
// There is deliberately NO Worker on this queue anywhere in the codebase: nothing
// consumes the DLQ automatically. A dead job stays dead until a user explicitly
// retries it through POST /api/jobs/:id/retry, which removes the DLQ entry and
// re-queues the job with a fresh retry budget.
export const deadLetterQueue = new Queue(DLQ_QUEUE_NAME, {
  connection: redis,
});

// BullMQ rejects ':' in custom job ids (they are used as Redis key separators), so
// the id is built with hyphens only. Deriving the id from jobId + attempt count
// makes the insert idempotent: re-running the dead-lettering for the same
// job+attempt state is a no-op instead of a duplicate DLQ row.
const buildDlqId = (jobId, attempts) => `dlq-${jobId}-${attempts}`;

export async function addToDeadLetterQueue({ jobId, reason, attempts }) {
  return deadLetterQueue.add(
    'dead-job',
    { jobId, reason, failedAt: new Date().toISOString() },
    { jobId: buildDlqId(jobId, attempts) }
  );
}

// Best-effort removal, used when a job is manually retried. remove() resolves to
// false when no entry with that id exists, which is the normal case (a job can be
// FAILED without ever having reached the DLQ, e.g. the DLQ push itself failed), so
// absence is not an error.
export async function removeFromDeadLetterQueue({ jobId, attempts }) {
  return deadLetterQueue.remove(buildDlqId(jobId, attempts));
}

export default deadLetterQueue;
