import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import {
  createVendorSchema,
  updateVendorSchema,
  getVendorSchema,
  listVendorsSchema,
  recordPaymentSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listVendorsSchema), controller.listVendors);
// Static routes before /:id so Express doesn't match "ledger" as an id
router.get('/:id/ledger', validate(getVendorSchema), controller.getVendorLedger);
router.post(
  '/:id/payments',
  authorize('owner', 'manager'),
  validate(recordPaymentSchema),
  controller.recordPayment
);
router.get('/:id', validate(getVendorSchema), controller.getVendorById);
router.post('/', authorize('owner', 'manager'), validate(createVendorSchema), controller.createVendor);
router.put('/:id', authorize('owner', 'manager'), validate(updateVendorSchema), controller.updateVendor);
router.delete('/:id', authorize('owner', 'manager'), validate(getVendorSchema), controller.deleteVendor);

export default router;
