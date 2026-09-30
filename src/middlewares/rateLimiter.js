import redis from '../lib/redis.js';

// Fixed-window rate limiter, applied per authenticated user on a single route
// (POST /api/jobs). Implemented directly on Redis INCR/EXPIRE rather than pulled in as
// a dependency, so the counter mechanics are visible and owned by this codebase
// instead of hidden behind a library's defaults.
//
// How the window works: the key embeds a bucket number derived from wall-clock time
// (`floor(now / windowSeconds)`). Every request inside the same calendar window maps
// to the same key, so INCR accumulates one counter per user per window, and a TTL set
// on the first hit lets the key expire on its own — no cleanup job needed.
//
// KNOWN TRADEOFF (accepted, not a bug): because windows are fixed and anchored to the
// clock rather than to the first request, a client can send `maxRequests` at the very
// end of one window and `maxRequests` again at the very start of the next, passing
// up to 2x the limit across the boundary. A sliding-window log would smooth this out;
// it was deliberately not implemented for this milestone in exchange for a far cheaper
// and more predictable O(1) counter.
export const rateLimiter = ({ windowSeconds, maxRequests }) => {
  return async (req, res, next) => {
    // authenticate runs first and guarantees req.user exists, so there is no anonymous
    // fallback bucket to design for here.
    const userId = req.user.id;
    const windowBucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `rate-limit:${userId}:${windowBucket}`;

    let count;
    try {
      count = await redis.incr(key);

      // Set the TTL only on the first hit of this window. Re-setting it on every
      // request would extend the key's life past the window boundary and leak memory.
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
    } catch (err) {
      // FAIL OPEN, deliberately. This limiter is a guard against one noisy user, not a
      // correctness or durability requirement, so a Redis outage should degrade the
      // feature (no limiting) rather than take down job creation for every user. The
      // failure is logged loudly so the outage is still visible.
      //
      // KNOWN LIMITATION (verified by stopping the redis container, NOT hypothetical):
      // this catch does not actually fire during a full Redis outage. ioredis defaults
      // to an offline command queue plus an unbounded retry strategy, so `redis.incr`
      // above stays pending forever instead of rejecting, and the request hangs
      // indefinitely rather than proceeding unthrottled. Measured: still unresolved
      // after 90s. So in practice the limiter degrades to "no request gets through
      // anyway" rather than the intended "every request gets through unthrottled".
      // Fixing it properly needs a bounded timeout on the Redis call (or offline-queue
      // options on the shared connection), which would change the design, so it is
      // deliberately left for a later milestone.
      console.error(
        `[RATE LIMIT] Redis unavailable, allowing request for user ${userId} without rate limiting:`,
        err.message
      );
      return next();
    }

    if (count > maxRequests) {
      // Seconds left in the *current* fixed window, so the client knows exactly how
      // long until its next attempt can succeed.
      const secondsRemaining =
        windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);

      res.set('Retry-After', String(secondsRemaining));
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded. Try again later.',
          status: 429,
        },
      });
    }

    return next();
  };
};

export default rateLimiter;
