import prisma from '../lib/prisma.js';
import redis from '../lib/redis.js';

const checkDatabase = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'connected';
  } catch {
    return 'disconnected';
  }
};

const checkRedis = async () => {
  try {
    await redis.ping();
    return 'connected';
  } catch {
    return 'disconnected';
  }
};

export const getHealth = async (req, res, next) => {
  const timestamp = new Date().toISOString();

  const [db, redisStatus] = await Promise.all([checkDatabase(), checkRedis()]);

  const isHealthy = db === 'connected' && redisStatus === 'connected';

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'error',
    db,
    redis: redisStatus,
    timestamp,
  });
};
