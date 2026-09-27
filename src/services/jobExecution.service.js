import prisma from '../lib/prisma.js';
import { getHandler } from '../handlers/index.js';

const FORCE_FAIL_MESSAGE = 'Simulated failure: forceFail flag set';

// Every Prisma call is funnelled through here so a database failure is logged as a
// distinct category ([DB_ERROR]) from a job-handler failure ([JOB_FAILED]), and keeps
// the operation that failed in the log line. The error is re-thrown so BullMQ records
// the queue message as failed instead of silently acknowledging it.
const runDbWrite = async (label, operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error(`[DB_ERROR] ${label} failed: ${error.message}`, error);
    throw error;
  }
};

const isForceFailRequested = (payload) =>
  typeof payload === 'object' && payload !== null && payload.forceFail === true;

const recordFailure = async ({ jobId, attemptId, attemptNumber, jobType, handlerError }) => {
  const errorMessage = handlerError?.message || 'Unknown error';
  const failedAt = new Date();

  try {
    await runDbWrite(`mark job ${jobId} FAILED`, () =>
      prisma.job.update({
        where: { id: jobId },
        data: { status: 'FAILED', failedAt, errorMessage },
      })
    );
    await runDbWrite(`mark attempt ${attemptNumber} of job ${jobId} FAILED`, () =>
      prisma.jobAttempt.update({
        where: { id: attemptId },
        data: { status: 'FAILED', completedAt: failedAt, errorMessage },
      })
    );
  } catch (dbError) {
    console.error(
      `[DB_ERROR] jobId=${jobId} attempt=${attemptNumber} handler error "${errorMessage}" could NOT be persisted: ${dbError.message}`
    );
    throw dbError;
  }

  console.error(
    `[JOB_FAILED] jobId=${jobId} attempt=${attemptNumber} type=${jobType} error="${errorMessage}"`
  );

  return { jobId, attemptNumber, outcome: 'FAILED', error: errorMessage };
};

export const executeJob = async ({ jobId }) => {
  const job = await runDbWrite(`fetch job ${jobId}`, () =>
    prisma.job.findUnique({ where: { id: jobId } })
  );

  if (!job) {
    // The queue referenced a job id that no longer exists in Postgres. Log it and move
    // on: one bad message must never take the whole worker process down.
    console.error(
      `[JOB_INTEGRITY] Queue message references job ${jobId} but no such row exists in Postgres. Skipping.`
    );
    return { jobId, outcome: 'SKIPPED_NOT_FOUND' };
  }

  const startedAt = new Date();

  const processingJob = await runDbWrite(`mark job ${jobId} PROCESSING`, () =>
    prisma.job.update({
      where: { id: jobId },
      data: { attempts: { increment: 1 }, status: 'PROCESSING', startedAt },
    })
  );
  const attemptNumber = processingJob.attempts;

  console.log(`[JOB] jobId=${jobId} type=${job.type} attempt=${attemptNumber} status=PROCESSING`);

  const attempt = await runDbWrite(`create attempt ${attemptNumber} for job ${jobId}`, () =>
    prisma.jobAttempt.create({
      data: { jobId, attemptNumber, status: 'PROCESSING', startedAt },
    })
  );

  let result;
  try {
    const handler = getHandler(job.type);

    if (isForceFailRequested(job.payload)) {
      throw new Error(FORCE_FAIL_MESSAGE);
    }

    result = await handler(job.payload);
  } catch (handlerError) {
    // Caught here, at the handler boundary: the job is recorded as FAILED and the error
    // is not re-thrown, so one failing job can never crash the worker process.
    return recordFailure({
      jobId,
      attemptId: attempt.id,
      attemptNumber,
      jobType: job.type,
      handlerError,
    });
  }

  const completedAt = new Date();

  await runDbWrite(`mark job ${jobId} COMPLETED`, () =>
    prisma.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt },
    })
  );
  await runDbWrite(`mark attempt ${attemptNumber} of job ${jobId} COMPLETED`, () =>
    prisma.jobAttempt.update({
      where: { id: attempt.id },
      data: { status: 'COMPLETED', completedAt },
    })
  );

  console.log(
    `[JOB] jobId=${jobId} attempt=${attemptNumber} status=COMPLETED result=${JSON.stringify(result)}`
  );

  return { jobId, attemptNumber, outcome: 'COMPLETED', result };
};

export default executeJob;
