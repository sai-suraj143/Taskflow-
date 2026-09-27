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

// BullMQ requires maxRetriesPerRequest: null for any connection it uses for blocking
// commands (a Worker throws "maxRetriesPerRequest must be null" otherwise), and a
// blocking connection must not be shared with non-blocking commands. Consumers of the
// queue therefore build their own connection here instead of reusing the default one,
// which stays untouched for regular commands such as the /health ping.
export const createBullMqConnection = () =>
  new Redis(config.redisUrl, { maxRetriesPerRequest: null });

export default redis;
