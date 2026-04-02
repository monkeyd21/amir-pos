import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { accountingController } from './controller';
import {
  createAccountSchema,
  updateAccountSchema,
  createJournalEntrySchema,
  listJournalEntriesSchema,
  ledgerSchema,
  pnlSchema,
  trialBalanceSchema,
} from './validators';

const router = Router();

router.use(authenticate);

// Chart of Accounts
router.get('/accounts', (req, res, next) =>
  accountingController.getAccounts(req, res, next)
);

router.post('/accounts', authorize('owner', 'manager'), validate(createAccountSchema), (req, res, next) =>
  accountingController.createAccount(req, res, next)
);

router.put('/accounts/:id', authorize('owner', 'manager'), validate(updateAccountSchema), (req, res, next) =>
  accountingController.updateAccount(req, res, next)
);

// Journal Entries
router.get('/journal-entries', validate(listJournalEntriesSchema), (req, res, next) =>
  accountingController.listJournalEntries(req, res, next)
);

router.post('/journal-entries', authorize('owner', 'manager'), validate(createJournalEntrySchema), (req, res, next) =>
  accountingController.createJournalEntry(req, res, next)
);

// Reports
router.get('/ledger', validate(ledgerSchema), (req, res, next) =>
  accountingController.getGeneralLedger(req, res, next)
);

router.get('/pnl', validate(pnlSchema), (req, res, next) =>
  accountingController.getProfitAndLoss(req, res, next)
);

router.get('/trial-balance', validate(trialBalanceSchema), (req, res, next) =>
  accountingController.getTrialBalance(req, res, next)
);

export default router;
