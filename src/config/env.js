import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = ['PORT', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(
      `Fatal Startup Error: Missing required environment variable: ${envVar}. Please check your .env configuration.`
    );
  }
}

// Optional integer env vars are parsed strictly: an unset value falls back to the
// default, but a present-and-invalid value is a configuration mistake that would
// otherwise silently turn into NaN/0 downstream (e.g. a 0ms backoff, which BullMQ
// would reject). Failing fast at startup is cheaper than debugging a hot retry loop.
const parseOptionalPositiveInt = (name, defaultValue) => {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Fatal Startup Error: ${name} must be a positive integer, received "${raw}".`
    );
  }

  return parsed;
};

export const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10,
  // Base delay for the BullMQ "exponential" backoff. Attempt n waits
  // RETRY_BACKOFF_BASE_MS * 2^(n-1). Known limitation: BullMQ's built-in
  // exponential backoff has no jitter, so retrying jobs can stampede Redis.
  retryBackoffBaseMs: parseOptionalPositiveInt('RETRY_BACKOFF_BASE_MS', 1000),
};

export default config;
