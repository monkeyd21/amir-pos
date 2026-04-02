import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { expenseService } from './service';

export class ExpenseController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await expenseService.list(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const expense = await expenseService.getById(parseInt(req.params.id));
      res.json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const expense = await expenseService.create({
        ...req.body,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const expense = await expenseService.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  async approve(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const expense = await expenseService.approve(parseInt(req.params.id), req.user!.userId);
      res.json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  async reject(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const expense = await expenseService.reject(parseInt(req.params.id), req.user!.userId);
      res.json({ success: true, data: expense });
    } catch (error) {
      next(error);
    }
  }

  async listCategories(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const categories = await expenseService.listCategories();
      res.json({ success: true, data: categories });
    } catch (error) {
      next(error);
    }
  }

  async createCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = await expenseService.createCategory(req.body);
      res.status(201).json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  }

  async updateCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = await expenseService.updateCategory(parseInt(req.params.id), req.body);
      res.json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  }

  async getSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await expenseService.getSummary(req.query as any);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const expenseController = new ExpenseController();
