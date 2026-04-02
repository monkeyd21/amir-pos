import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import * as controller from './controller';
import { loginSchema, refreshSchema, changePasswordSchema } from './validators';

const router = Router();

router.post('/login', validate(loginSchema), controller.login);
router.post('/refresh', validate(refreshSchema), controller.refresh);
router.post('/change-password', authenticate, validate(changePasswordSchema), controller.changePassword);

export default router;
