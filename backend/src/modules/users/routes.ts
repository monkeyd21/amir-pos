import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createUserSchema, updateUserSchema, listUsersSchema, getUserSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/me', controller.getMe);
router.get('/', validate(listUsersSchema), controller.listUsers);
router.get('/:id', validate(getUserSchema), controller.getUserById);
router.post('/', authorize('owner', 'manager'), validate(createUserSchema), controller.createUser);
router.put('/:id', authorize('owner', 'manager'), validate(updateUserSchema), controller.updateUser);
router.delete('/:id', authorize('owner', 'manager'), validate(getUserSchema), controller.deleteUser);

export default router;
