import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { posService } from './service';
import { getSetting } from '../settings/service';
import {
  DEFAULT_UPI_CONFIG,
  buildUpiUri,
  normaliseUpiConfig,
  resolveUpiAccount,
  upiQrDataUrl,
} from '../../utils/upi';

export class PosController {
  async openSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await posService.openSession(
        req.user!.userId,
        req.user!.branchId,
        req.body.openingAmount,
        req.body.notes
      );
      res.status(201).json({
        success: true,
        data: session,
        message: 'POS session opened',
      });
    } catch (error) {
      next(error);
    }
  }

  async closeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.finalizeCloseSession(
        req.user!.userId,
        req.body,
        req.user!.branchId
      );
      res.json({
        success: true,
        data: result,
        message: 'POS session closed',
      });
    } catch (error) {
      next(error);
    }
  }

  async sessionExpected(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { session, expectedAmount, expectedUpi, expectedCard } = await posService.closeSession(req.user!.userId);
      res.json({
        success: true,
        data: {
          sessionId: session.id,
          openingAmount: Number(session.openingAmount),
          // §8.1 — three independent expected figures, never combined.
          expectedAmount,
          expectedUpi,
          expectedCard,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async currentSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const session = await posService.getCurrentSession(req.user!.userId);
      res.json({ success: true, data: session });
    } catch (error) {
      next(error);
    }
  }

  // §8.0 — suggested opening balance for the Day-Start screen.
  async suggestedOpening(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const suggested = await posService.suggestedOpeningBalance(req.user!.userId);
      res.json({ success: true, data: { suggested } });
    } catch (error) {
      next(error);
    }
  }

  async checkout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.checkout(
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(result.idempotent ? 200 : 201).json({
        success: true,
        data: result.sale,
        change: result.change,
        refund: result.refund,
        idempotent: result.idempotent ?? false,
        message: result.idempotent ? 'Sale already recorded' : 'Sale completed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async searchProducts(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const query = (req.query.q || req.query.query || '') as string;
      const results = await posService.searchProducts(query, req.user!.branchId);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }

  async catalog(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await posService.getCatalog(req.user!.branchId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async quickCreateProduct(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const variant = await posService.quickCreateProduct(
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({ success: true, data: variant, message: 'Product created and stocked' });
    } catch (error) {
      next(error);
    }
  }

  async lookupBarcode(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const variant = await posService.lookupBarcode(
        req.params.barcode,
        req.user!.branchId
      );
      res.json({ success: true, data: variant });
    } catch (error) {
      next(error);
    }
  }

  async evaluateCart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await posService.evaluateCart(req.body.items);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async holdCart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.holdCart(
        req.user!.userId,
        req.user!.branchId,
        req.body.cartData,
        req.body.customerId,
        req.body.notes
      );
      res.status(201).json({
        success: true,
        data: held,
        message: 'Cart held successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async listHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.listHeld(req.user!.branchId);
      res.json({ success: true, data: held });
    } catch (error) {
      next(error);
    }
  }

  async deleteHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await posService.deleteHeld(parseInt(req.params.id));
      res.json({ success: true, message: 'Held transaction deleted' });
    } catch (error) {
      next(error);
    }
  }

  async resumeHeld(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const held = await posService.resumeHeld(parseInt(req.params.id));
      res.json({
        success: true,
        data: held,
        message: 'Held transaction resumed',
      });
    } catch (error) {
      next(error);
    }
  }
  async createUpiPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.createUpiPayment(
        req.body, req.user!.userId, req.user!.branchId
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  async checkUpiPaymentStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await posService.checkUpiPaymentStatus(
        req.params.intentId, req.user!.userId
      );
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  /**
   * bug3 — the UPI accounts the cashier may collect into. Inactive accounts are
   * withheld: they are kept in config for history, not offered at the counter.
   */
  async upiAccounts(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const cfg = normaliseUpiConfig(await getSetting<unknown>('upiConfig', DEFAULT_UPI_CONFIG));
      res.json({
        success: true,
        data: cfg.accounts
          .filter((a) => a.active)
          .map((a) => ({ id: a.id, label: a.label, vpa: a.vpa, isDefault: a.isDefault })),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * bug3 — render a scan-to-pay QR for the amount currently due, against the
   * chosen account (or the store default). Generated server-side because the QR
   * encoder lives here, and returned as a data URL the payment panel can show
   * inline without a second round trip for the image.
   */
  async upiQr(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, error: 'A positive amount is required' });
      }

      const cfg = normaliseUpiConfig(await getSetting<unknown>('upiConfig', DEFAULT_UPI_CONFIG));
      const account = resolveUpiAccount(cfg, req.body?.accountId);
      if (!account) {
        return res.status(400).json({
          success: false,
          error: 'No UPI account is configured. Add one under Settings → UPI.',
        });
      }

      const uri = buildUpiUri({
        vpa: account.vpa,
        name: account.merchantName || undefined,
        amount,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      });

      res.json({
        success: true,
        data: {
          accountId: account.id,
          label: account.label,
          vpa: account.vpa,
          amount,
          uri,
          qr: await upiQrDataUrl(uri),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async handlePaymentWebhook(req: Request, res: Response) {
    try {
      await posService.handleUpiWebhook(
        req.headers as Record<string, string>,
        req.body.toString()
      );
    } catch (error) {
      console.error('Webhook error:', error);
    }
    res.json({ success: true }); // Always 200 to ACK
  }
}

export const posController = new PosController();
