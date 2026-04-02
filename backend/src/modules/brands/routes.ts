import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createBrandSchema, updateBrandSchema, getBrandSchema, listBrandsSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listBrandsSchema), controller.listBrands);
router.get('/:id', validate(getBrandSchema), controller.getBrandById);
router.post('/', authorize('owner', 'manager'), validate(createBrandSchema), controller.createBrand);
router.put('/:id', authorize('owner', 'manager'), validate(updateBrandSchema), controller.updateBrand);
router.delete('/:id', authorize('owner', 'manager'), validate(getBrandSchema), controller.deleteBrand);

export default router;
