import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { employeeService } from './service';

export class EmployeeController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.list(req.query as any, req.user?.role);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const employee = await employeeService.create(req.body);
      res.status(201).json({ success: true, data: employee });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const employee = await employeeService.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: employee });
    } catch (error) {
      next(error);
    }
  }

  // ─── Attendance (status-based, §3.2) ──────────────
  // Clock-in / clock-out are gone; a day is a single marked status.

  async upsertAttendance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.upsertAttendance(req.body, {
        userId: req.user!.userId,
        branchId: req.user!.branchId,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async bulkAttendance(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.bulkUpsertAttendance(req.body, {
        userId: req.user!.userId,
        branchId: req.user!.branchId,
      });
      res.status(201).json({
        success: true,
        data: result,
        message: `${result.marked} employee(s) marked for ${result.date}`,
      });
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
      const commission = await employeeService.payCommission(parseInt(req.params.id), {
        userId: req.user!.userId,
        branchId: req.user!.branchId,
      });
      res.json({ success: true, data: commission });
    } catch (error) {
      next(error);
    }
  }

  async payCommissionsBulk(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.payCommissionsBulk(
        {
          startDate: req.body.startDate,
          endDate: req.body.endDate,
          userId: req.body.userId,
        },
        { userId: req.user!.userId, branchId: req.user!.branchId }
      );
      res.json({
        success: true,
        data: result,
        message: `${result.paidCount} commission(s) marked as paid`,
      });
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

  // ─── Payroll (§3.3) ───────────────────────────────

  async getPayroll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getPayrollMonth(req.query as any, {
        branchId: req.user!.branchId,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getPayrollDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getPayrollDetail(
        parseInt(req.params.userId),
        req.params.month
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async finalisePayroll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.finalisePayroll(
        parseInt(req.params.userId),
        req.params.month,
        { userId: req.user!.userId, branchId: req.user!.branchId }
      );
      res.status(201).json({
        success: true,
        data: result,
        message: `Salary finalised for ${req.params.month}`,
      });
    } catch (error) {
      next(error);
    }
  }

  async payPayroll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.payPayroll(
        parseInt(req.params.userId),
        req.params.month,
        req.body,
        { userId: req.user!.userId }
      );
      res.json({ success: true, data: result, message: 'Salary marked as paid' });
    } catch (error) {
      next(error);
    }
  }

  async reopenPayroll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.reopenPayroll(
        parseInt(req.params.userId),
        req.params.month
      );
      res.json({ success: true, data: result, message: 'Salary period reopened' });
    } catch (error) {
      next(error);
    }
  }

  async getCommissionStatement(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.getCommissionStatement(req.query as any);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const employeeController = new EmployeeController();
