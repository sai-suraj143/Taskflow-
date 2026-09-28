import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
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

router.post('/', create);
router.get('/', list);
// Declared before '/:id' so the more specific paths are matched first. Express paths
// are exact matches, so the order is stylistic rather than required.
router.get('/:id/attempts', listAttempts);
router.post('/:id/retry', retry);
router.get('/:id', getById);
router.delete('/:id', cancel);

export default router;