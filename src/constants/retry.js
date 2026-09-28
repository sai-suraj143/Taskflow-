// How many extra attempts a manual retry grants a FAILED job.
//
// Manual retry never resets Job.attempts: JobAttempt has a
// @@unique([jobId, attemptNumber]) constraint, so resetting the counter to 0 would
// collide with the existing attempt rows and abort the whole retry. Instead the
// retry budget is added to maxAttempts, and the attempt counter keeps climbing
// (attempts 4, 5, 6 for a job that died at 3/3), so the attempt history stays a
// complete, gap-free audit trail.
export const MANUAL_RETRY_BUDGET = 3;

export default MANUAL_RETRY_BUDGET;
