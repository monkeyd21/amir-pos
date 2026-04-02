import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './controller';
import { createCategorySchema, updateCategorySchema, getCategorySchema, listCategoriesSchema } from './validators';

const router = Router();

router.use(authenticate);

router.get('/', validate(listCategoriesSchema), controller.listCategories);
router.get('/:id', validate(getCategorySchema), controller.getCategoryById);
router.post('/', authorize('owner', 'manager'), validate(createCategorySchema), controller.createCategory);
router.put('/:id', authorize('owner', 'manager'), validate(updateCategorySchema), controller.updateCategory);
router.delete('/:id', authorize('owner', 'manager'), validate(getCategorySchema), controller.deleteCategory);

export default router;
