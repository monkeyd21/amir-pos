import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createBranchSchema, updateBranchSchema, getBranchSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/', controller.listBranches);
router.get('/:id', validate(getBranchSchema), controller.getBranchById);
router.post('/', authorize('owner'), validate(createBranchSchema), controller.createBranch);
router.put('/:id', authorize('owner', 'manager'), validate(updateBranchSchema), controller.updateBranch);
router.delete('/:id', authorize('owner'), validate(getBranchSchema), controller.deleteBranch);

export default router;
