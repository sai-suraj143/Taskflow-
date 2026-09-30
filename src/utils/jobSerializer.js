export const serializeJob = (job) => ({
  id: job.id,
  userId: job.userId,
  type: job.type,
  payload: job.payload,
  status: job.status,
  priority: job.priority,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  errorMessage: job.errorMessage,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  failedAt: job.failedAt,
  // null for any job created without an Idempotency-Key header, since the feature is
  // opt-in. Exposed so a client that used a key can correlate its own retries.
  idempotencyKey: job.idempotencyKey,
});

export const serializeJobList = (jobs) => jobs.map(serializeJob);

export const serializeJobAttempt = (attempt) => ({
  id: attempt.id,
  jobId: attempt.jobId,
  attemptNumber: attempt.attemptNumber,
  status: attempt.status,
  errorMessage: attempt.errorMessage,
  startedAt: attempt.startedAt,
  completedAt: attempt.completedAt,
  createdAt: attempt.createdAt,
});

export const serializeJobAttemptList = (attempts) => attempts.map(serializeJobAttempt);
