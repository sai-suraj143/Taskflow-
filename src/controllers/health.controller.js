import prisma from '../lib/prisma.js';

export const getHealth = async (req, res, next) => {
  const timestamp = new Date().toISOString();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      timestamp,
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
      message: 'Database connectivity check failed',
      timestamp,
    });
  }
};
