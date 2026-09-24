import { createJob, listJobs, getJobById, cancelJob } from '../services/job.service.js';
import { serializeJob, serializeJobList } from '../utils/jobSerializer.js';
import { isValidJobType, JOB_TYPES } from '../constants/jobTypes.js';

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const isValidPayload = (payload) =>
  typeof payload === 'object' && payload !== null && !Array.isArray(payload);

const VALID_PRIORITIES = ['HIGH', 'NORMAL', 'LOW'];

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

  try {
    const job = await createJob({
      userId: req.user.id,
      type,
      payload,
      priority,
    });
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