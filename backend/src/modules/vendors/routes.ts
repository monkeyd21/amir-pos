import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import {
  createVendorSchema,
  updateVendorSchema,
  getVendorSchema,
  listVendorsSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listVendorsSchema), controller.listVendors);
router.get('/:id', validate(getVendorSchema), controller.getVendorById);
router.post('/', authorize('owner', 'manager'), validate(createVendorSchema), controller.createVendor);
router.put('/:id', authorize('owner', 'manager'), validate(updateVendorSchema), controller.updateVendor);
router.delete('/:id', authorize('owner', 'manager'), validate(getVendorSchema), controller.deleteVendor);

export default router;
