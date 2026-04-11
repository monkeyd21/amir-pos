import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { printingController } from './controller';
import {
  createProfileSchema,
  updateProfileSchema,
  profileIdParamSchema,
  createTemplateSchema,
  updateTemplateSchema,
  templateIdParamSchema,
  listTemplatesSchema,
  printSchema,
  testPrintSchema,
} from './validators';

// Ensure all drivers and transports self-register.
// Importing ./index.ts loads every driver and transport module.
import './index';

const router = Router();

router.use(authenticate);

// ─── Drivers + transports (introspection) ───────────────────────
router.get('/drivers', printingController.listDrivers);
router.get('/transports', printingController.listTransports);
router.get('/discover', authorize('owner', 'manager'), printingController.discover);

// ─── Printer profiles (branch-scoped) ────────────────────────────
router.get('/profiles', printingController.listProfiles);
router.post(
  '/profiles',
  authorize('owner', 'manager'),
  validate(createProfileSchema),
  printingController.createProfile
);
router.get(
  '/profiles/:id',
  validate(profileIdParamSchema),
  printingController.getProfile
);
router.put(
  '/profiles/:id',
  authorize('owner', 'manager'),
  validate(updateProfileSchema),
  printingController.updateProfile
);
router.delete(
  '/profiles/:id',
  authorize('owner', 'manager'),
  validate(profileIdParamSchema),
  printingController.deleteProfile
);
router.put(
  '/profiles/:id/default',
  authorize('owner', 'manager'),
  validate(profileIdParamSchema),
  printingController.setDefaultProfile
);
router.post(
  '/profiles/:id/test',
  validate(testPrintSchema),
  printingController.testPrint
);

// ─── Label templates (scoped to a profile) ───────────────────────
router.get(
  '/profiles/:profileId/templates',
  validate(listTemplatesSchema),
  printingController.listTemplates
);
router.post(
  '/profiles/:profileId/templates',
  authorize('owner', 'manager'),
  validate(createTemplateSchema),
  printingController.createTemplate
);
router.get(
  '/templates/:id',
  validate(templateIdParamSchema),
  printingController.getTemplate
);
router.put(
  '/templates/:id',
  authorize('owner', 'manager'),
  validate(updateTemplateSchema),
  printingController.updateTemplate
);
router.delete(
  '/templates/:id',
  authorize('owner', 'manager'),
  validate(templateIdParamSchema),
  printingController.deleteTemplate
);

// ─── Print endpoint (the one the barcode screen calls) ─────────
router.post('/print', validate(printSchema), printingController.print);

export default router;
