import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { create, list, getById, cancel } from '../controllers/job.controller.js';

const router = Router();

router.use(authenticate);

router.post('/', create);
router.get('/', list);
router.get('/:id', getById);
router.delete('/:id', cancel);

export default router;