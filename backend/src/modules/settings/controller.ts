import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import {
  getLabelTemplate,
  saveLabelTemplate,
  resetLabelTemplate,
} from './service';
import { LabelTemplate } from '../inventory/barcodePrinter';

export class SettingsController {
  async getLabelTemplate(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await getLabelTemplate();
      res.json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  }

  async updateLabelTemplate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await saveLabelTemplate(req.body as LabelTemplate);
      res.json({
        success: true,
        data: template,
        message: 'Label template saved',
      });
    } catch (error) {
      next(error);
    }
  }

  async resetLabelTemplate(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const template = await resetLabelTemplate();
      res.json({
        success: true,
        data: template,
        message: 'Label template reset to defaults',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const settingsController = new SettingsController();
