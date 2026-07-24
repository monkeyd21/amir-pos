import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { AuthRequest } from '../../middleware/auth';
import { getSetting, setSetting } from './service';
import { isOwnerPinSet, setOwnerPin } from '../../services/owner-pin';
import { recordAudit } from '../../services/audit';
import prisma from '../../config/database';

const router = Router();

router.use(authenticate);

// §6.4 — Owner PIN. Status tells the UI whether a PIN is configured (PIN-gated
// actions shouldn't be reachable before one is set); the setter creates or
// changes it (owner only, audited; changing requires the current PIN).
router.get(
  '/owner-pin/status',
  authorize('owner'),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: { configured: await isOwnerPinSet() } });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/owner-pin',
  authorize('owner'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const changing = await isOwnerPinSet();
      await setOwnerPin(req.body.newPin, req.body.currentPin);
      await recordAudit(prisma, {
        action: changing ? 'settings.ownerPin.changed' : 'settings.ownerPin.set',
        entityType: 'setting',
        entityId: 0,
        userId: req.user!.userId,
        branchId: req.user!.branchId,
        data: {},
      });
      res.json({ success: true, data: { configured: true }, message: 'Owner PIN saved' });
    } catch (error) {
      next(error);
    }
  }
);

// Bug#2 — refund/return window in days (default 15). Exchanges stay at 15.
router.get('/return-window', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { returnWindowDays: await getSetting<number>('returnWindowDays', 15) } });
  } catch (error) {
    next(error);
  }
});
router.put(
  '/return-window',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const days = Number(req.body.returnWindowDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        return res.status(400).json({ success: false, error: 'returnWindowDays must be an integer 0–365' });
      }
      await setSetting('returnWindowDays', days);
      res.json({ success: true, data: { returnWindowDays: days }, message: 'Return window updated' });
    } catch (error) {
      next(error);
    }
  }
);

// §bug2/§bug3 — GST compliance switch. While OFF (the default), CGST/SGST/tax
// lines are hidden on printed receipts and in the Sales bill-breakup, even though
// tax is still computed and stored for future GSTR-1 filing. Flip ON once GST
// compliance becomes mandatory to reveal the tax breakup everywhere.
router.get('/gst-compliance', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { enabled: await getSetting<boolean>('gstComplianceEnabled', false) } });
  } catch (error) {
    next(error);
  }
});
router.put(
  '/gst-compliance',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const enabled = Boolean(req.body.enabled);
      await setSetting('gstComplianceEnabled', enabled);
      res.json({ success: true, data: { enabled }, message: 'GST compliance setting updated' });
    } catch (error) {
      next(error);
    }
  }
);

// §8.3 — EOD variance threshold (₹). A single value applied uniformly to all
// three reconciliation modes (Cash/UPI/Card). Variance ≥ this blocks close until
// Owner PIN + reason for that mode; under it auto-approves. Default ₹50.
router.get('/variance-threshold', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { varianceThreshold: await getSetting<number>('varianceThreshold', 50) } });
  } catch (error) {
    next(error);
  }
});
router.put(
  '/variance-threshold',
  authorize('owner'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const amount = Number(req.body.varianceThreshold);
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
        return res.status(400).json({ success: false, error: 'varianceThreshold must be a number between 0 and 100000' });
      }
      await setSetting('varianceThreshold', amount);
      res.json({ success: true, data: { varianceThreshold: amount }, message: 'Variance threshold updated' });
    } catch (error) {
      next(error);
    }
  }
);

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

// Commission daily-sales threshold (₹): commission is earned only on the portion
// of an employee's own daily sales ABOVE this figure. 0 = no threshold.
router.get('/commission-threshold', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const threshold = await getSetting<number>('commissionDailyThreshold', 0);
    res.json({ success: true, data: { commissionDailyThreshold: Number(threshold) || 0 } });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/commission-threshold',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const value = Number(req.body.commissionDailyThreshold);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({
          success: false,
          error: 'commissionDailyThreshold must be a number ≥ 0',
        });
      }
      await setSetting('commissionDailyThreshold', value);
      res.json({
        success: true,
        data: { commissionDailyThreshold: value },
        message: 'Commission threshold updated',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Bill numbering: per-channel prefixes for human-friendly sale numbers (W-0001 / O-0001).
// `pad` controls zero-padding width of the running counter.
const DEFAULT_BILL_NUMBERING = { walkin: 'W', online: 'O', pad: 4 };

router.get('/bill-numbering', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await getSetting('billNumbering', DEFAULT_BILL_NUMBERING);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/bill-numbering',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await getSetting<any>('billNumbering', DEFAULT_BILL_NUMBERING);
      const updated = { ...existing };
      if (typeof req.body.walkin === 'string' && req.body.walkin.trim()) {
        updated.walkin = req.body.walkin.trim().toUpperCase();
      }
      if (typeof req.body.online === 'string' && req.body.online.trim()) {
        updated.online = req.body.online.trim().toUpperCase();
      }
      if (req.body.pad !== undefined) {
        const pad = Number(req.body.pad);
        if (!Number.isInteger(pad) || pad < 1 || pad > 10) {
          return res.status(400).json({ success: false, error: 'pad must be an integer between 1 and 10' });
        }
        updated.pad = pad;
      }
      await setSetting('billNumbering', updated);
      res.json({ success: true, data: updated, message: 'Bill numbering updated' });
    } catch (error) {
      next(error);
    }
  }
);

// §2.1/2.2/2.4 — Card & UPI payment accounts (bank/gateway list + a default per
// mode). Stored as { card: [{name, isDefault}], upi: [{name, isDefault}] }.
const DEFAULT_PAYMENT_ACCOUNTS = { card: [] as any[], upi: [] as any[] };

function normalizeAccounts(list: any): { name: string; isDefault: boolean }[] {
  if (!Array.isArray(list)) return [];
  const cleaned = list
    .map((a) => ({ name: String(a?.name ?? '').trim(), isDefault: !!a?.isDefault }))
    .filter((a) => a.name.length > 0);
  // At most one default per mode — keep the first flagged.
  let seenDefault = false;
  for (const a of cleaned) {
    if (a.isDefault && !seenDefault) seenDefault = true;
    else a.isDefault = false;
  }
  return cleaned;
}

router.get('/payment-accounts', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await getSetting('paymentAccounts', DEFAULT_PAYMENT_ACCOUNTS);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/payment-accounts',
  authorize('owner', 'manager'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const updated = {
        card: normalizeAccounts(req.body.card),
        upi: normalizeAccounts(req.body.upi),
      };
      await setSetting('paymentAccounts', updated);
      res.json({ success: true, data: updated, message: 'Payment accounts updated' });
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
