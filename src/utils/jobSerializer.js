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
});

export const serializeJobList = (jobs) => jobs.map(serializeJob);