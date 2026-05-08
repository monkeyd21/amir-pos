import PDFDocument from 'pdfkit';

export interface ReceiptSale {
  saleNumber: string;
  createdAt: Date | string;
  branch: { name: string; address?: string | null; phone?: string | null; receiptHeader?: string | null; receiptFooter?: string | null };
  user: { firstName: string; lastName: string };
  customer?: { firstName: string; lastName: string; phone: string } | null;
  items: Array<{
    quantity: number;
    unitPrice: number | string;
    discount?: number | string;
    taxAmount?: number | string;
    total: number | string;
    variant: {
      size: string;
      color: string;
      sku: string;
      product: {
        name: string;
        hsnCode?: string | null;
        cgstRate?: number | string;
        sgstRate?: number | string;
        priceIncludesTax?: boolean;
      };
    };
  }>;
  payments: Array<{ method: string; amount: number | string }>;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  total: number | string;
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
export function buildReceiptPdf(sale: ReceiptSale): Promise<Buffer> {
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
    const saleDate = new Date(sale.createdAt).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Bill: ${sale.saleNumber}`, { continued: false });
    doc.text(`Date: ${saleDate}`);
    doc.text(`Cashier: ${sale.user.firstName} ${sale.user.lastName}`);
    if (sale.customer) {
      doc.text(`Customer: ${sale.customer.firstName} ${sale.customer.lastName}`);
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
    for (const item of sale.items) {
      const rowTop = doc.y;
      const name = `${item.variant.product.name}`;
      const meta = [item.variant.size, item.variant.color].filter(Boolean).join(' / ');
      const hsn = item.variant.product.hsnCode || '';

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

      doc.moveDown(0.3);
    }

    doc.moveDown(0.1);
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.3);

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
    doc.strokeColor('#000').lineWidth(0.5).moveTo(12, doc.y).lineTo(12 + W, doc.y).stroke();
    doc.moveDown(0.2);
    row('TOTAL', fmtINR(sale.total), true);

    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8);
    for (const p of sale.payments) {
      doc.text(`${p.method.toUpperCase()}: ${fmtINR(p.amount)}`, { align: 'right' });
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
