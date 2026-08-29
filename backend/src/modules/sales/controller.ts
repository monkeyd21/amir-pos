import { Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthRequest } from '../../middleware/auth';
import { salesService } from './service';
import { buildReceiptPdf } from './receipt-pdf';
import { getSetting } from '../settings/service';
import {
  buildUpiUri,
  upiQrPng,
  DEFAULT_UPI_CONFIG,
  normaliseUpiConfig,
  defaultUpiAccount,
} from '../../utils/upi';

export class SalesController {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.listSales(req.query as any, req.user!.branchId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
      next(error);
    }
  }

  async returnableByBarcode(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.getReturnableByBarcode(
        req.params.barcode,
        req.user!.branchId
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const param = req.params.id;
      const sale = /^\d+$/.test(param)
        ? await salesService.getSaleById(parseInt(param))
        : await salesService.getSaleBySaleNumber(param);
      res.json({ success: true, data: sale });
    } catch (error) {
      next(error);
    }
  }

  async receipt(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const receiptData = await salesService.getReceiptData(parseInt(req.params.id));
      res.json({ success: true, data: receiptData });
    } catch (error) {
      next(error);
    }
  }

  // §1.3a — customer-facing refund/exchange breakup receipt.
  async returnReceipt(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await salesService.getReturnReceiptData(parseInt(req.params.returnId));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Returns a PDF of the receipt. Used by the mobile POS share intent to
   * attach the bill to a WhatsApp message (or any share target).
   */
  async receiptPdf(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id, 10);
      const sale = await prisma.sale.findUnique({
        where: { id },
        include: {
          branch: true,
          customer: true,
          user: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              variant: { include: { product: true } },
            },
          },
          payments: true,
        },
      });
      if (!sale) throw new AppError('Sale not found', 404);

      // §bug13 — include the items exchanged/returned against this bill so the
      // shared PDF shows both the sold and the returned goods.
      let exchangedItems: Array<{ name: string; variant: string; quantity: number; unitPrice: number; mrp: number; total: number }> = [];
      let exchangeOriginalSaleNumber: string | null = null;
      if (sale.exchangeReturnId) {
        const ret = await prisma.return.findUnique({
          where: { id: sale.exchangeReturnId },
          include: {
            originalSale: { select: { saleNumber: true } },
            items: { include: { saleItem: { include: { variant: { include: { product: true } } } } } },
          },
        });
        exchangeOriginalSaleNumber = ret?.originalSale?.saleNumber ?? null;
        exchangedItems = (ret?.items ?? []).map((ri) => {
          const si = ri.saleItem;
          const netUnit = si.quantity > 0 ? Number(si.total) / si.quantity : Number(si.total);
          const mrp =
            si.variant.mrpOverride != null
              ? Number(si.variant.mrpOverride)
              : si.variant.product.mrp != null
              ? Number(si.variant.product.mrp)
              : Number(si.variant.product.basePrice);
          return {
            name: si.variant.product.name,
            variant: `${si.variant.size} / ${si.variant.color}`,
            quantity: ri.quantity,
            unitPrice: Math.round(netUnit * 100) / 100,
            mrp: Math.round(mrp * 100) / 100,
            total: Math.round(netUnit * ri.quantity * 100) / 100,
          };
        });
      }

      const showGst = await getSetting<boolean>('gstComplianceEnabled', false);

      // §upi — scan-to-pay QR with the payable amount pre-filled, when a store
      // VPA is configured. Amount = total less any exchange credit.
      // bug3 — the printed QR uses the store's DEFAULT collection account.
      const upiCfg = normaliseUpiConfig(await getSetting<unknown>('upiConfig', DEFAULT_UPI_CONFIG));
      const upiAccount = defaultUpiAccount(upiCfg);
      const amountDue = Math.max(0, Number(sale.total) - Number(sale.exchangeCreditAmount || 0));
      let upi: { qr: Buffer; vpa: string; amount: number } | null = null;
      if (upiAccount && amountDue > 0) {
        const uri = buildUpiUri({
          vpa: upiAccount.vpa,
          name: upiAccount.merchantName || sale.branch.name,
          amount: amountDue,
          note: sale.saleNumber,
        });
        upi = { qr: await upiQrPng(uri), vpa: upiAccount.vpa, amount: amountDue };
      }

      const pdf = await buildReceiptPdf(
        { ...(sale as any), exchangedItems, exchangeOriginalSaleNumber },
        showGst,
        upi
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${sale.saleNumber}.pdf"`
      );
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  }

  async processReturn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.processReturn(
        parseInt(req.params.saleId),
        req.body,
        req.user!.userId,
        req.user!.branchId,
        req.user!.role
      );
      res.status(201).json({
        success: true,
        data: result.returnRecord,
        refundAmount: result.refundAmount,
        refundBreakup: result.refundBreakup,
        refundMode: result.refundMode,
        message: 'Return processed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async rejectInspection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.logInspectionRejection(
        parseInt(req.params.saleId),
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({ success: true, data: result, message: 'Rejection recorded' });
    } catch (error) {
      next(error);
    }
  }

  async processExchange(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await salesService.processExchange(
        parseInt(req.params.saleId),
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.status(201).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }

  async assignAgents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const saleId = parseInt(req.params.saleId, 10);
      const result = await salesService.assignAgents(saleId, req.body);
      res.json({ success: true, data: result, message: 'Agents assigned' });
    } catch (error) {
      next(error);
    }
  }

  // bug5 — correct the customer name/contact on a closed bill.
  async updateBillCustomer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const saleId = parseInt(req.params.saleId, 10);
      const result = await salesService.updateBillCustomer(
        saleId,
        req.body,
        req.user!.userId,
        req.user!.branchId
      );
      res.json({
        success: true,
        data: result,
        message: result.attached ? 'Customer attached to bill' : 'Customer details corrected',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const salesController = new SalesController();
