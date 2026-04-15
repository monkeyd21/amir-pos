import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { AuthRequest } from '../../middleware/auth';
import { getSetting, setSetting } from './service';

const router = Router();

router.use(authenticate);

// Commission mode: 'item_level' (per-agent per line item) or 'bill_level' (per-cashier per sale)
router.get('/commission-mode', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const mode = await getSetting<string>('commissionMode', 'item_level');
    res.json({ success: true, data: { commissionMode: mode } });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/commission-mode',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mode = req.body.commissionMode;
      if (mode !== 'item_level' && mode !== 'bill_level') {
        return res.status(400).json({
          success: false,
          error: 'commissionMode must be "item_level" or "bill_level"',
        });
      }
      await setSetting('commissionMode', mode);
      res.json({ success: true, data: { commissionMode: mode }, message: 'Commission mode updated' });
    } catch (error) {
      next(error);
    }
  }
);

// Messaging config (stored in settings table, not env vars — so it's editable at runtime)
router.get('/messaging', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await getSetting<any>('messagingConfig', {
      whatsappEnabled: false,
      whatsappPhoneNumberId: '',
      whatsappAccessToken: '',
      smsEnabled: false,
      smsProvider: 'none',
      smsApiKey: '',
      smsSenderId: '',
    });
    // Mask tokens for security
    if (data.whatsappAccessToken) {
      data.whatsappAccessToken = data.whatsappAccessToken.slice(0, 8) + '****';
    }
    if (data.smsApiKey) {
      data.smsApiKey = data.smsApiKey.slice(0, 8) + '****';
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/messaging',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Merge with existing to preserve masked fields user didn't change
      const existing = await getSetting<any>('messagingConfig', {});
      const updated = { ...existing };

      if (req.body.whatsappEnabled !== undefined) updated.whatsappEnabled = req.body.whatsappEnabled;
      if (req.body.whatsappPhoneNumberId !== undefined) updated.whatsappPhoneNumberId = req.body.whatsappPhoneNumberId;
      if (req.body.whatsappAccessToken && !req.body.whatsappAccessToken.includes('****')) {
        updated.whatsappAccessToken = req.body.whatsappAccessToken;
      }
      if (req.body.smsEnabled !== undefined) updated.smsEnabled = req.body.smsEnabled;
      if (req.body.smsProvider !== undefined) updated.smsProvider = req.body.smsProvider;
      if (req.body.smsApiKey && !req.body.smsApiKey.includes('****')) {
        updated.smsApiKey = req.body.smsApiKey;
      }
      if (req.body.smsSenderId !== undefined) updated.smsSenderId = req.body.smsSenderId;

      await setSetting('messagingConfig', updated);
      res.json({ success: true, data: updated, message: 'Messaging config saved' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
