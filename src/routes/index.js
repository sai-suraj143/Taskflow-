import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import jobRoutes from './job.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/jobs', jobRoutes);

export default router;
