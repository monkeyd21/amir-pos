import { Router } from 'express';
import { authenticate } from '../../middleware/auth';

/**
 * Settings module — currently a thin shell. Store/branch settings live
 * elsewhere and label templates moved to the printing module. This file
 * exists so the existing `/api/v1/settings` prefix stays registered and
 * future generic settings can slot in without schema changes.
 */
const router = Router();

router.use(authenticate);

export default router;
