import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { lookupBarcodeSchema, generateBarcodeSchema, printBatchSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/lookup/:barcode', validate(lookupBarcodeSchema), controller.lookupByBarcode);
router.post('/generate', authorize('owner', 'manager'), validate(generateBarcodeSchema), controller.generateBarcode);
router.post('/print-batch', validate(printBatchSchema), controller.printBatch);

export default router;
