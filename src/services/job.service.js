import prisma from '../lib/prisma.js';

const createServiceError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export const createJob = ({ userId, type, payload, priority }) => {
  return prisma.job.create({
    data: {
      userId,
      type,
      payload,
      ...(priority ? { priority } : {}),
    },
  });
};

export const listJobs = async ({ userId, role, page, limit }) => {
  const where = role === 'ADMIN' ? {} : { userId };

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.job.count({ where }),
  ]);

  return { jobs, total, page, limit };
};

const fetchOwnedJob = async ({ jobId, userId, role }) => {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job || (job.userId !== userId && role !== 'ADMIN')) {
    throw createServiceError('Job not found', 404);
  }

  return job;
};

export const getJobById = ({ jobId, userId, role }) => {
  return fetchOwnedJob({ jobId, userId, role });
};

export const cancelJob = async ({ jobId, userId, role }) => {
  const job = await fetchOwnedJob({ jobId, userId, role });

  if (job.status !== 'QUEUED') {
    throw createServiceError('Only jobs in QUEUED status can be cancelled', 409);
  }

  return prisma.job.update({
    where: { id: jobId },
    data: { status: 'CANCELLED' },
  });
};