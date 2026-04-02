import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { accountingService } from './service';

export class AccountingController {
  async getAccounts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const accounts = await accountingService.getAccounts();
      res.json({ success: true, data: accounts });
    } catch (error) {
      next(error);
    }
  }

  async createAccount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const account = await accountingService.createAccount(req.body);
      res.status(201).json({ success: true, data: account });
    } catch (error) {
      next(error);
    }
  }

  async updateAccount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const account = await accountingService.updateAccount(parseInt(req.params.id), req.body);
      res.json({ success: true, data: account });
    } catch (error) {
      next(error);
    }
  }

  async listJournalEntries(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await accountingService.listJournalEntries(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async createJournalEntry(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const entry = await accountingService.createJournalEntry({
        ...req.body,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  }

  async getGeneralLedger(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const ledger = await accountingService.getGeneralLedger(req.query as any);
      res.json({ success: true, data: ledger });
    } catch (error) {
      next(error);
    }
  }

  async getProfitAndLoss(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pnl = await accountingService.getProfitAndLoss(req.query as any);
      res.json({ success: true, data: pnl });
    } catch (error) {
      next(error);
    }
  }

  async getTrialBalance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const tb = await accountingService.getTrialBalance(req.query as any);
      res.json({ success: true, data: tb });
    } catch (error) {
      next(error);
    }
  }
}

export const accountingController = new AccountingController();
