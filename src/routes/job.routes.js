import { Router } from 'express';
import config from '../config/env.js';
import { authenticate } from '../middlewares/authenticate.js';
import { rateLimiter } from '../middlewares/rateLimiter.js';
import {
  create,
  list,
  getById,
  cancel,
  listAttempts,
  retry,
} from '../controllers/job.controller.js';

const router = Router();

router.use(authenticate);

// Scoped to job creation only, and deliberately placed after authenticate because the
// limiter keys on req.user.id. Reads, cancel, attempts and retry are left unlimited:
// they are cheap, and limiting them would make ordinary polling of a job's status
// block the user from actually creating one.
const createRateLimiter = rateLimiter({
  windowSeconds: config.rateLimitWindowSeconds,
  maxRequests: config.rateLimitMaxRequests,
});

router.post('/', createRateLimiter, create);
router.get('/', list);
// Declared before '/:id' so the more specific paths are matched first. Express paths
// are exact matches, so the order is stylistic rather than required.
router.get('/:id/attempts', listAttempts);
router.post('/:id/retry', retry);
router.get('/:id', getById);
router.delete('/:id', cancel);

export default router;