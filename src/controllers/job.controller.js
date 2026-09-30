import {
  createJob,
  listJobs,
  getJobById,
  cancelJob,
  getJobAttempts,
  retryJob,
} from '../services/job.service.js';
import {
  serializeJob,
  serializeJobList,
  serializeJobAttemptList,
} from '../utils/jobSerializer.js';
import { isValidJobType, JOB_TYPES } from '../constants/jobTypes.js';

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const isValidPayload = (payload) =>
  typeof payload === 'object' && payload !== null && !Array.isArray(payload);

const VALID_PRIORITIES = ['HIGH', 'NORMAL', 'LOW'];

// Upper bound on a client-supplied idempotency key. The key is stored verbatim on the
// Job row, so an unbounded header would let any caller write arbitrarily long strings
// into the database. 255 comfortably covers UUIDs and typical request-scoped keys.
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export const create = async (req, res, next) => {
  const { type, payload, priority } = req.body || {};

  if (!type || typeof type !== 'string' || !isValidJobType(type)) {
    return next(
      createValidationError(`type must be one of the following: ${JOB_TYPES.join(', ')}`)
    );
  }
  if (!isValidPayload(payload)) {
    return next(createValidationError('payload must be a JSON object'));
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return next(createValidationError('priority must be one of HIGH, NORMAL, LOW'));
  }

  // Optional header: absent means "no idempotency requested" and is never an error.
  // Present-but-empty is a client mistake, not an opt-out, and is rejected so a silent
  // typo cannot quietly disable protection the caller believed they had.
  const rawIdempotencyKey = req.get('Idempotency-Key');
  let idempotencyKey = null;

  if (rawIdempotencyKey !== undefined) {
    if (rawIdempotencyKey.trim() === '') {
      return next(
        createValidationError('Idempotency-Key header must not be empty if provided')
      );
    }
    if (rawIdempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return next(
        createValidationError(
          `Idempotency-Key header must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`
        )
      );
    }
    idempotencyKey = rawIdempotencyKey;
  }

  try {
    const { job, isReplay } = await createJob({
      userId: req.user.id,
      type,
      payload,
      priority,
      idempotencyKey,
    });

    // A replay returns 200, not 202: nothing new was accepted and nothing was enqueued,
    // so the request has not been queued for processing. The header makes the
    // distinction explicit for a client that needs to branch on it.
    if (isReplay) {
      res.set('X-Idempotent-Replay', 'true');
      return res.status(200).json({ data: serializeJob(job) });
    }

    return res.status(202).json({ data: serializeJob(job) });
  } catch (error) {
    return next(error);
  }
};

export const list = async (req, res, next) => {
  let page = parseInt(req.query.page, 10) || 1;
  let limit = parseInt(req.query.limit, 10) || 20;

  page = Math.max(page, 1);
  limit = Math.min(Math.max(limit, 1), 100);

  try {
    const { jobs, total } = await listJobs({
      userId: req.user.id,
      role: req.user.role,
      page,
      limit,
    });
    return res.status(200).json({
      data: serializeJobList(jobs),
      meta: { total, page, limit },
    });
  } catch (error) {
    return next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const job = await getJobById({
      jobId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
    });
    return res.status(200).json({ data: serializeJob(job) });
  } catch (error) {
    return next(error);
  }
};

export const cancel = async (req, res, next) => {
  try {
    const job = await cancelJob({
      jobId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
    });
    return res.status(200).json({ data: serializeJob(job) });
  } catch (error) {
    return next(error);
  }
};

export const listAttempts = async (req, res, next) => {
  try {
    const attempts = await getJobAttempts({
      jobId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
    });
    return res.status(200).json({ data: serializeJobAttemptList(attempts) });
  } catch (error) {
    return next(error);
  }
};

export const retry = async (req, res, next) => {
  try {
    const job = await retryJob({
      jobId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
    });
    // 202, not 200: the job has been accepted back into the queue but has not run.
    // The work is still pending, exactly like a freshly created job.
    return res.status(202).json({ data: serializeJob(job) });
  } catch (error) {
    return next(error);
  }
};