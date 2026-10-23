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
  bulkCreateVariantsSchema,
  imageUploadSchema,
  updateImageSchema,
  reorderImagesSchema,
  deleteImageSchema,
} from './validators';
import { singleImageUpload } from '../../middleware/upload';

const router = Router();

router.use(authenticate);

router.get('/', validate(listProductsSchema), controller.listProducts);
// Static route MUST precede '/:id' so "valuation" isn't captured as an id param.
router.get('/valuation', controller.getInventoryValuation);
router.get('/:id', validate(getProductSchema), controller.getProductById);
router.post('/', authorize('owner', 'manager'), validate(createProductSchema), controller.createProduct);
router.put('/:id', authorize('owner', 'manager'), validate(updateProductSchema), controller.updateProduct);
router.delete('/:id', authorize('owner', 'manager'), validate(getProductSchema), controller.deleteProduct);

// Variant routes
router.post('/:id/variants', authorize('owner', 'manager'), validate(createVariantSchema), controller.addVariant);
router.post('/:id/variants/bulk', authorize('owner', 'manager'), validate(bulkCreateVariantsSchema), controller.bulkCreateVariants);
router.put('/:id/variants/:variantId', authorize('owner', 'manager'), validate(updateVariantSchema), controller.updateVariant);
router.delete('/:id/variants/:variantId', authorize('owner', 'manager'), validate(deleteVariantSchema), controller.deleteVariant);

// Photo routes. '/images/order' is static, so it comes before '/images/:imageId'.
router.get('/:id/images', validate(getProductSchema), controller.listImages);
router.post('/:id/images', authorize('owner', 'manager'), singleImageUpload, validate(imageUploadSchema), controller.addImage);
router.put('/:id/images/order', authorize('owner', 'manager'), validate(reorderImagesSchema), controller.reorderImages);
router.patch('/:id/images/:imageId', authorize('owner', 'manager'), validate(updateImageSchema), controller.updateImage);
router.delete('/:id/images/:imageId', authorize('owner', 'manager'), validate(deleteImageSchema), controller.deleteImage);

export default router;
