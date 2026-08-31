import PDFDocument from 'pdfkit';

export interface ReceiptSale {
  saleNumber: string;
  createdAt: Date | string;
  // §11.0/§bug1 — trading day the bill belongs to. During post-midnight peak-season
  // trading this is the (earlier) day the shift opened, so the bill prints the
  // previous day's date while the TIME below stays the real billing time.
  businessDate?: Date | string | null;
  branch: { name: string; address?: string | null; phone?: string | null; receiptHeader?: string | null; receiptFooter?: string | null };
  user: { firstName: string; lastName: string };
  customer?: { firstName: string; lastName: string; phone: string } | null;
  items: Array<{
    quantity: number;
    unitPrice: number | string;
    discount?: number | string;
    taxAmount?: number | string;
    total: number | string;
    nonReturnable?: boolean; // SaleItem-level flag (line marked at checkout)
    isClearance?: boolean; // §2.4 — line sold from clearance
    variant: {
      size: string;
      color: string;
      sku: string;
      mrpOverride?: number | string | null;
      product: {
        name: string;
        hsnCode?: string | null;
        mrp?: number | string | null;
        basePrice?: number | string | null;
        cgstRate?: number | string;
        sgstRate?: number | string;
        priceIncludesTax?: boolean;
        nonReturnable?: boolean;
        exchangeOnly?: boolean;
      };
    };
  }>;
  payments: Array<{ method: string; amount: number | string }>;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  total: number | string;
  // §bug13 — items returned/exchanged against this bill (shown after the sold
  // items). Populated by the caller when the sale has an exchange credit.
  exchangeOriginalSaleNumber?: string | null;
  exchangedItems?: Array<{
    name: string;
    variant: string;
    quantity: number;
    unitPrice: number;
    mrp?: number;
    total: number;
  }>;
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Apportion the consolidated `sale.taxAmount` into CGST + SGST chunks
 * by walking the line items. Falls back to a 50/50 split if no rate
 * metadata is attached. Returns `allSameRate=true` when every line uses
 * identical CGST and SGST rates (the common intra-state case) so the
 * receipt can show "CGST @ 9%" instead of an unlabelled total.
 */
function computeGstSplit(sale: ReceiptSale): {
  cgst: number;
  sgst: number;
  cgstRate: number;
  sgstRate: number;
  allSameRate: boolean;
} {
  let cgst = 0;
  let sgst = 0;
  const cgstRates = new Set<number>();
  const sgstRates = new Set<number>();
  for (const item of sale.items) {
    const lineTax = n(item.taxAmount);
    if (lineTax === 0) continue;
    const c = n(item.variant.product.cgstRate);
    const s = n(item.variant.product.sgstRate);
    const totalRate = c + s;
    if (totalRate <= 0) continue;
    cgst += (lineTax * c) / totalRate;
    sgst += (lineTax * s) / totalRate;
    cgstRates.add(c);
    sgstRates.add(s);
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    cgst: round(cgst),
    sgst: round(sgst),
    cgstRate: cgstRates.size === 1 ? [...cgstRates][0] : 0,
    sgstRate: sgstRates.size === 1 ? [...sgstRates][0] : 0,
    allSameRate: cgstRates.size === 1 && sgstRates.size === 1,
  };
}
const fmtINR = (v: unknown) =>
  'Rs. ' +
  n(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Generate a thermal-receipt-style PDF on A5 paper (roughly bill-sized).
 * Returns a Buffer suitable for HTTP download or WhatsApp attachment.
 */
export function buildReceiptPdf(
  sale: ReceiptSale,
  showGst = false,
  upi?: { qr: Buffer; vpa: string; amount: number } | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [226.77, 841.89], // ~80mm wide thermal roll (A5-ish narrow)
      margins: { top: 16, bottom: 16, left: 12, right: 12 },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 226.77 - 24; // content width

    // Header
    doc.font('Helvetica-Bold').fontSize(13).text(sale.branch.name, { align: 'center' });
    if (sale.branch.address) {
      doc.font('Helvetica').fontSize(8).text(sale.branch.address, { align: 'center' });
    }
    if (sale.branch.phone) {
      doc.font('Helvetica').fontSize(8).text(sale.branch.phone, { align: 'center' });
    }
    if (sale.branch.receiptHeader) {
      doc.moveDown(0.3).font('Helvetica').fontSize(8).text(sale.branch.receiptHeader, { align: 'center' });
    }

    doc.moveDown(0.5);
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.3);

    // Sale metadata
    doc.font('Helvetica').fontSize(8);
    // §bug1 — DATE = business (trading) date; TIME = actual billing time.
    const billDate = new Date(sale.businessDate ?? sale.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const billTime = new Date(sale.createdAt).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Bill: ${sale.saleNumber}`, { continued: false });
    doc.text(`Date: ${billDate}   Time: ${billTime}`);
    doc.text(`Cashier: ${sale.user.firstName} ${sale.user.lastName}`);
    if (sale.customer) {
      doc.text(`Customer: ${`${sale.customer.firstName} ${sale.customer.lastName ?? ''}`.trim()}`);
      doc.text(`Phone: ${sale.customer.phone}`);
    }

    doc.moveDown(0.3);
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.3);

    // Items header — narrower Item column to make room for HSN
    doc.font('Helvetica-Bold').fontSize(8);
    const headerY = doc.y;
    doc.text('Item', 12, headerY, { width: W * 0.46 });
    doc.text('HSN', 12 + W * 0.46, headerY, { width: W * 0.13, align: 'left' });
    doc.text('Qty', 12 + W * 0.59, headerY, { width: W * 0.12, align: 'right' });
    doc.text('Total', 12 + W * 0.71, headerY, { width: W * 0.29, align: 'right' });
    doc.moveDown(0.4);

    // Items — render each row with an explicit row-height so qty/total on the
    // right and product-name + meta on the left can't overlap the divider below.
    let anyNonReturnable = false;
    let anyExchangeOnly = false;
    for (const item of sale.items) {
      const rowTop = doc.y;
      const name = `${item.variant.product.name}`;
      const meta = [item.variant.size, item.variant.color].filter(Boolean).join(' / ');
      const hsn = item.variant.product.hsnCode || '';

      // §1.2 — per-line sale-policy marker.
      // §2.4/bug2 — a clearance line carries nonReturnable at the line level but
      // IS exchangeable, so it must not print the blanket NON-RETURNABLE marker
      // that tells the customer (and the cashier) no swap is possible. It gets
      // its own wording: not returnable for cash, exchange still available.
      const clearanceLine = Boolean(item.isClearance);
      const nonReturnable =
        !clearanceLine && (Boolean(item.nonReturnable) || Boolean(item.variant.product.nonReturnable));
      const exchangeOnly =
        !nonReturnable && (clearanceLine || Boolean(item.variant.product.exchangeOnly));
      if (nonReturnable) anyNonReturnable = true;
      if (exchangeOnly) anyExchangeOnly = true;
      const flagText = nonReturnable
        ? '** NON-RETURNABLE'
        : clearanceLine
        ? '** NOT RETURNABLE - EXCHANGE ONLY'
        : exchangeOnly
        ? '** EXCHANGE ONLY'
        : '';

      // Anchor Qty + Total + HSN to the top of the row
      doc.font('Helvetica').fontSize(8);
      doc.text(hsn, 12 + W * 0.46, rowTop, { width: W * 0.13, align: 'left' });
      doc.text(String(item.quantity), 12 + W * 0.59, rowTop, { width: W * 0.12, align: 'right' });
      doc.text(fmtINR(item.total), 12 + W * 0.71, rowTop, { width: W * 0.29, align: 'right' });

      // Product name on the left (flows naturally below rowTop)
      doc.text(name, 12, rowTop, { width: W * 0.46 });

      if (meta) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(7)
          .text(meta, 12, doc.y, { width: W * 0.46 })
          .font('Helvetica')
          .fontSize(8);
      }

      // Print the tag MRP against what was actually charged whenever the two
      // differ — not only on clearance, which is all this used to do. The POS
      // charges the Sale Price (MRP − 10%), so an ordinary line otherwise shows
      // its price twice and the saving is invisible until the bill total.
      //
      // Prefer the MRP snapshotted onto the SaleItem at checkout: it is what the
      // tag said on the day, even if the variant has been repriced since.
      const lineMrp = n(
        (item as any).mrp ??
          item.variant.mrpOverride ??
          item.variant.product.mrp ??
          item.variant.product.basePrice
      );
      if (lineMrp > n(item.unitPrice)) {
        doc
          .font('Helvetica')
          .fontSize(7)
          .text(
            `${item.isClearance ? 'CLEARANCE — MRP' : 'MRP'} ${fmtINR(lineMrp)}`,
            12,
            doc.y,
            { width: W * 0.7 }
          )
          .fontSize(8);
      } else if (item.isClearance) {
        doc.font('Helvetica').fontSize(7).text('CLEARANCE', 12, doc.y, { width: W * 0.7 }).fontSize(8);
      }

      if (flagText) {
        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(flagText, 12, doc.y, { width: W * 0.7 })
          .font('Helvetica')
          .fontSize(8);
      }

      doc.moveDown(0.3);
    }

    doc.moveDown(0.1);
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.3);

    // §bug13 — items returned/exchanged against this bill, listed under the sold
    // items so both halves of the swap appear on one receipt.
    if (sale.exchangedItems && sale.exchangedItems.length > 0) {
      const heading = sale.exchangeOriginalSaleNumber
        ? `EXCHANGED (vs ${sale.exchangeOriginalSaleNumber})`
        : 'ITEMS EXCHANGED (returned)';
      doc.font('Helvetica-Bold').fontSize(8).text(heading, 12, doc.y, { width: W });
      doc.font('Helvetica').fontSize(8);
      for (const it of sale.exchangedItems) {
        const rowTop = doc.y;
        doc.text(String(it.quantity), 12 + W * 0.59, rowTop, { width: W * 0.12, align: 'right' });
        doc.text('- ' + fmtINR(it.total), 12 + W * 0.71, rowTop, { width: W * 0.29, align: 'right' });
        doc.text(it.name, 12, rowTop, { width: W * 0.58 });
        if (it.variant) {
          doc.font('Helvetica-Oblique').fontSize(7).text(it.variant, 12, doc.y, { width: W * 0.58 }).font('Helvetica').fontSize(8);
        }
        if (it.mrp) {
          doc.fontSize(7).text(`MRP ${fmtINR(it.mrp)}`, 12, doc.y, { width: W * 0.58 }).fontSize(8);
        }
        doc.moveDown(0.3);
      }
      doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
      doc.moveDown(0.3);
    }

    // §1.2 — legend for the sale-policy markers above.
    if (anyNonReturnable || anyExchangeOnly) {
      doc.font('Helvetica-Bold').fontSize(7);
      if (anyNonReturnable) {
        doc.text('** NON-RETURNABLE items cannot be returned or exchanged.', 12, doc.y, { width: W });
      }
      if (anyExchangeOnly) {
        doc.text('** Items marked EXCHANGE ONLY / NOT RETURNABLE can be exchanged for equal or greater value, but never refunded in cash.', 12, doc.y, { width: W });
      }
      doc.font('Helvetica').fontSize(8);
      doc.moveDown(0.2);
      doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
      doc.moveDown(0.3);
    }

    // Totals
    const row = (label: string, value: string, bold = false) => {
      const yy = doc.y;
      if (bold) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      doc.fontSize(bold ? 10 : 8);
      doc.text(label, 12, yy, { width: W * 0.6 });
      doc.text(value, 12 + W * 0.6, yy, { width: W * 0.4, align: 'right' });
      doc.moveDown(0.3);
    };
    row('Subtotal', fmtINR(sale.subtotal));
    if (n(sale.discountAmount) > 0) row('Discount', '- ' + fmtINR(sale.discountAmount));
    // Split the consolidated taxAmount into CGST + SGST per Indian GST
    // rules. We approximate the split by the *rate* ratio across the
    // basket — for an intra-state bill where every line is 9+9 this is
    // a clean 50/50, and for mixed lines it's still proportional.
    // §bug2 — tax lines are hidden until GST compliance is switched on (tax is
    // still computed/stored on the sale for future GSTR-1). `showGst` is resolved
    // from the gstComplianceEnabled setting by the caller.
    if (showGst) {
      const gst = computeGstSplit(sale);
      if (gst.cgst > 0) {
        row(`CGST${gst.allSameRate ? ` @ ${gst.cgstRate}%` : ''}`, fmtINR(gst.cgst));
      }
      if (gst.sgst > 0) {
        row(`SGST${gst.allSameRate ? ` @ ${gst.sgstRate}%` : ''}`, fmtINR(gst.sgst));
      }
      if (gst.cgst === 0 && gst.sgst === 0 && n(sale.taxAmount) > 0) {
        // Fallback if items don't carry rate metadata (legacy sales)
        row('Tax (incl.)', fmtINR(sale.taxAmount));
      }
    }
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.2);
    row('TOTAL', fmtINR(sale.total), true);

    // "You Saved" = aggregate tag MRP (Σ mrp × qty) − the bill total. Each line's
    // MRP is floored at its charged price so a missing/stale MRP can't go negative.
    const totalMrp = sale.items.reduce((sum, item) => {
      const resolvedMrp = n(
        item.variant.mrpOverride ?? item.variant.product.mrp ?? item.variant.product.basePrice
      );
      const perUnitMrp = Math.max(n(item.unitPrice), resolvedMrp);
      return sum + perUnitMrp * n(item.quantity);
    }, 0);
    const saved = Math.max(0, Math.round((totalMrp - n(sale.total)) * 100) / 100);
    if (saved > 0) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(10).text(`You Saved ${fmtINR(saved)}`, 12, doc.y, {
        width: W,
        align: 'center',
      });
      doc.font('Helvetica').fontSize(8);
    }

    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8);
    for (const p of sale.payments) {
      doc.text(`${p.method.toUpperCase()}: ${fmtINR(p.amount)}`, { align: 'right' });
    }

    // §upi — scan-to-pay QR (amount pre-filled). Passed in only when a store VPA
    // is configured; PDFKit doesn't advance the cursor for images, so nudge `y`.
    if (upi) {
      doc.moveDown(0.6);
      doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9).text('SCAN TO PAY · UPI', 12, doc.y, { width: W, align: 'center' });
      doc.moveDown(0.3);
      const qrSize = 120;
      doc.image(upi.qr, 12 + (W - qrSize) / 2, doc.y, { width: qrSize, height: qrSize });
      doc.y += qrSize + 4;
      doc.font('Helvetica').fontSize(8).text(upi.vpa, 12, doc.y, { width: W, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(`Amount: ${fmtINR(upi.amount)}`, 12, doc.y, { width: W, align: 'center' });
    }

    // Footer — use branch-configured footer if set, otherwise a default line
    doc.moveDown(0.6);
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.4);
    const footerText = sale.branch.receiptFooter?.trim() || 'Thank you for shopping with us!';
    doc.font('Helvetica-Oblique').fontSize(8).text(footerText, { align: 'center' });

    doc.end();
  });
}
