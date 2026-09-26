import Redis from 'ioredis';
import config from '../config/env.js';

const globalForRedis = globalThis;

export const redis = globalForRedis.redis || new Redis(config.redisUrl);

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

redis.on('error', (error) => {
  console.error('[REDIS] Connection error:', error.message);
});

export default redis;
