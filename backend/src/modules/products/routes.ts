import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import {
  createProductSchema,
  updateProductSchema,
  getProductSchema,
  listProductsSchema,
  createVariantSchema,
  updateVariantSchema,
  deleteVariantSchema,
} from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listProductsSchema), controller.listProducts);
router.get('/:id', validate(getProductSchema), controller.getProductById);
router.post('/', authorize('owner', 'manager'), validate(createProductSchema), controller.createProduct);
router.put('/:id', authorize('owner', 'manager'), validate(updateProductSchema), controller.updateProduct);
router.delete('/:id', authorize('owner', 'manager'), validate(getProductSchema), controller.deleteProduct);

// Variant routes
router.post('/:id/variants', authorize('owner', 'manager'), validate(createVariantSchema), controller.addVariant);
router.put('/:id/variants/:variantId', authorize('owner', 'manager'), validate(updateVariantSchema), controller.updateVariant);
router.delete('/:id/variants/:variantId', authorize('owner', 'manager'), validate(deleteVariantSchema), controller.deleteVariant);

export default router;
