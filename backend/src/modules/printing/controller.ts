import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as service from './service';

export class PrintingController {
  // ─── Profile CRUD ─────────────────────────────────────────────

  async listProfiles(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.listProfiles(req.user!.branchId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.getProfile(
        req.user!.branchId,
        parseInt(req.params.id, 10)
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async createProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.createProfile(req.user!.branchId, req.body);
      res
        .status(201)
        .json({ success: true, data, message: 'Printer profile created' });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.updateProfile(
        req.user!.branchId,
        parseInt(req.params.id, 10),
        req.body
      );
      res.json({ success: true, data, message: 'Printer profile updated' });
    } catch (err) {
      next(err);
    }
  }

  async deleteProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await service.deleteProfile(
        req.user!.branchId,
        parseInt(req.params.id, 10)
      );
      res.json({ success: true, message: 'Printer profile deleted' });
    } catch (err) {
      next(err);
    }
  }

  async setDefaultProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.setDefaultProfile(
        req.user!.branchId,
        parseInt(req.params.id, 10)
      );
      res.json({ success: true, data, message: 'Default printer updated' });
    } catch (err) {
      next(err);
    }
  }

  // ─── Template CRUD ────────────────────────────────────────────

  async listTemplates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.listTemplates(
        req.user!.branchId,
        parseInt(req.params.profileId, 10)
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async createTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.createTemplate(
        req.user!.branchId,
        parseInt(req.params.profileId, 10),
        req.body
      );
      res.status(201).json({ success: true, data, message: 'Template created' });
    } catch (err) {
      next(err);
    }
  }

  async updateTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.updateTemplate(
        req.user!.branchId,
        parseInt(req.params.id, 10),
        req.body
      );
      res.json({ success: true, data, message: 'Template updated' });
    } catch (err) {
      next(err);
    }
  }

  async deleteTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await service.deleteTemplate(
        req.user!.branchId,
        parseInt(req.params.id, 10)
      );
      res.json({ success: true, message: 'Template deleted' });
    } catch (err) {
      next(err);
    }
  }

  async getTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.getTemplate(
        req.user!.branchId,
        parseInt(req.params.id, 10)
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  // ─── Print + test print ──────────────────────────────────────

  async print(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.print(req.user!.branchId, req.body);
      res.json({
        success: true,
        data: result,
        message: `Sent ${result.labelsPrinted} label(s) via ${result.driver}/${result.transport}`,
      });
    } catch (err) {
      next(err);
    }
  }

  async testPrint(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await service.testPrint(
        req.user!.branchId,
        parseInt(req.params.id, 10),
        req.body?.templateId,
        req.body?.overrideTemplate
      );
      res.json({
        success: true,
        data: result,
        message: 'Test label sent',
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Discovery + introspection ──────────────────────────────

  async discover(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await service.discover();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async listDrivers(_req: AuthRequest, res: Response, _next: NextFunction) {
    res.json({ success: true, data: service.describeDrivers() });
  }

  async listTransports(_req: AuthRequest, res: Response, _next: NextFunction) {
    res.json({ success: true, data: service.describeTransports() });
  }
}

export const printingController = new PrintingController();
