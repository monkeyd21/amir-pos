import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { employeeService } from './service';

export class EmployeeController {
  async clockIn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const branchId = req.body.branchId || req.user!.branchId;
      const record = await employeeService.clockIn(req.user!.userId, branchId);
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }

  async clockOut(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const record = await employeeService.clockOut(req.user!.userId);
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }

  async listAttendance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.listAttendance(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getAttendanceSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getAttendanceSummary(req.query as any);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async listCommissions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.listCommissions(req.query as any);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async calculateCommissions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.calculateCommissions(req.query as any);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async payCommission(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const commission = await employeeService.payCommission(parseInt(req.params.id));
      res.json({ success: true, data: commission });
    } catch (error) {
      next(error);
    }
  }

  async getCommissionSummary(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getCommissionSummary(req.query as any);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const employeeController = new EmployeeController();
