import { Injectable } from '@angular/core';
import { ApiService } from '../core/services/api.service';
import { firstValueFrom } from 'rxjs';

interface ReceiptItem {
  name: string;
  variant: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  total: number;
  /** Loyalty points redeemed against this line (this line's proportional
   *  share of the bill's total redemption). Undefined/0 when none redeemed. */
  loyaltyPointsRedeemed?: number;
  nonReturnable?: boolean;
  exchangeOnly?: boolean;
}

interface ReceiptPayment {
  method: string;
  amount: number;
  referenceNumber?: string;
}

interface ReceiptData {
  receiptHeader: string | null;
  receiptFooter: string | null;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  saleNumber: string;
  date: string;
  cashier: string;
  customer: { name: string; phone: string } | null;
  items: ReceiptItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  payments: ReceiptPayment[];
  loyaltyPointsEarned: number;
  loyaltyPointsRedeemed: number;
  exchangeCredit?: number;
  exchangeRefund?: number;
  exchangeOriginalSaleNumber?: string | null;
}

interface ReceiptResponse {
  success: boolean;
  data: ReceiptData;
}

/**
 * One printed line. The receipt is a flat list of these, laid out on a
 * monospace grid (COLS wide) and rendered to a 1-bit bitmap for printing.
 */
interface ReceiptRow {
  text: string;
  bold?: boolean;
  align?: 'left' | 'center';
  /** Larger type — used for the store name only. */
  big?: boolean;
  /** A vertical spacer, not a text line. */
  blank?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReceiptPrintService {
  constructor(private api: ApiService) {}

  // ── Thermal geometry ────────────────────────────────────────────
  //
  // The receipt is drawn to a pure black/white bitmap at the printer's native
  // dot width and printed as an image. This is deliberate: a thermal head is
  // 1-bit (a dot is either burned or not), but a browser renders text with
  // GRAYSCALE anti-aliasing on the glyph edges. When that grayscale page is
  // sent through the OS print pipeline to a 1-bit thermal printer, the driver
  // DITHERS the gray edges into scattered dots — which at receipt sizes comes
  // out as the smeared, doubled, unreadable text we were seeing. By rendering
  // ourselves and thresholding every pixel to pure black or white, there is no
  // grayscale left for the driver to dither, so the print is crisp.
  //
  // 80mm paper → 576 printable dots @203 dpi ≈ 72mm of print width. If the
  // shop ever moves to 58mm paper, set DOTS=384 / WIDTH_MM=48.
  private readonly DOTS = 576;
  private readonly WIDTH_MM = 72;
  /** Monospace columns the text layout is designed around (== divider width). */
  private readonly COLS = 40;
  /** Luminance cutoff for 1-bit thresholding. Higher = thicker/darker glyphs,
   *  which read better on thermal paper that tends to print thin. */
  private readonly THRESHOLD = 168;

  // §bug2 — the printed receipt hides the Tax line until GST compliance is turned
  // on. Resolved per-print from the gstComplianceEnabled setting (default hidden).
  private showGst = false;

  private async fetchGstEnabled(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.api.get<{ data: { enabled: boolean } }>('/settings/gst-compliance')
      );
      return !!res.data?.enabled;
    } catch {
      return false;
    }
  }

  async printReceipt(saleId: number): Promise<void> {
    const res = await firstValueFrom(
      this.api.get<ReceiptResponse>(`/sales/${saleId}/receipt`)
    );
    const receipt = res.data;
    this.showGst = await this.fetchGstEnabled();

    const rows = this.buildReceiptRows(receipt);
    const canvas = this.renderRowsToBitmap(rows);
    this.printBitmap(canvas, `Receipt - ${receipt.saleNumber}`);
  }

  /**
   * §1.3a — print/show the customer-facing refund/exchange breakup receipt for
   * a completed return. Same 1-bit thermal render as a sale receipt.
   */
  async printRefundReceipt(returnId: number): Promise<void> {
    const res = await firstValueFrom(
      this.api.get<{ success: boolean; data: any }>(`/sales/returns/${returnId}/receipt`)
    );
    const r = res.data;
    const rows = this.buildRefundRows(r);
    const title = String(r.type || 'return').toUpperCase() === 'EXCHANGE' ? 'EXCHANGE' : 'REFUND';
    const canvas = this.renderRowsToBitmap(rows);
    this.printBitmap(canvas, `${title} - ${r.returnNumber}`);
  }

  // ── Row builders (the receipt layout) ───────────────────────────

  private buildReceiptRows(r: ReceiptData): ReceiptRow[] {
    const divider = '='.repeat(this.COLS);
    const thin = '-'.repeat(this.COLS);
    const rows: ReceiptRow[] = [];
    const push = (text: string, opts: Partial<ReceiptRow> = {}) => rows.push({ text, ...opts });
    const line = (l: string, v: string) => l + this.pad(l, v) + v;

    push(divider, { align: 'center' });
    push(r.branchName, { align: 'center', bold: true, big: true });
    if (r.branchAddress) push(r.branchAddress, { align: 'center' });
    if (r.branchPhone) push('Phone: ' + r.branchPhone, { align: 'center' });
    push(divider, { align: 'center' });
    if (r.receiptHeader) {
      push(r.receiptHeader, { align: 'center' });
      push(thin);
    }

    push(`Sale #: ${r.saleNumber}`);
    push(`Date: ${this.formatDate(r.date)}`);
    push(`Cashier: ${r.cashier}`);
    if (r.customer) {
      push(
        `Customer: ${r.customer.name}${r.customer.phone ? ' (' + r.customer.phone + ')' : ''}`
      );
    }
    push(thin);
    push('', { blank: true });

    push('ITEMS:');
    for (const item of r.items) {
      push(item.name);
      if (item.variant) push('  ' + item.variant);
      const priceLine = `  ${item.quantity} x ${this.formatCurrency(item.unitPrice)}`;
      const totalStr = this.formatCurrency(item.total);
      push(priceLine + this.pad(priceLine, totalStr) + totalStr);
      if (item.discount > 0) {
        push(line('    Disc:', `-${this.formatCurrency(item.discount)}`));
      }
      // Per-item loyalty points redeemed — this line's share of the bill's
      // redemption, so the customer sees which items the points came off.
      if (item.loyaltyPointsRedeemed && item.loyaltyPointsRedeemed > 0) {
        push(line('    Loyalty:', `-${item.loyaltyPointsRedeemed} pts`));
      }
      // §1.2 — flag non-returnable / exchange-only goods on the printed bill.
      if (item.nonReturnable) push('  ** NON-RETURNABLE **', { bold: true });
      else if (item.exchangeOnly) push('  ** EXCHANGE ONLY **', { bold: true });
    }
    push(thin);

    push(line('Subtotal:', this.formatCurrency(r.subtotal)));
    if (r.discountAmount > 0) {
      push(line('Discount:', `-${this.formatCurrency(r.discountAmount)}`));
    }
    // Tax line only when GST compliance is on.
    if (this.showGst) {
      push(line('Tax:', this.formatCurrency(r.taxAmount)));
    }
    push(thin);
    push(line('TOTAL:', this.formatCurrency(r.total)), { bold: true });

    // Exchange: goods returned and credited against this bill.
    const exchangeCredit = r.exchangeCredit || 0;
    const exchangeRefund = r.exchangeRefund || 0;
    if (exchangeCredit > 0) {
      push(line('Exchange credit:', `-${this.formatCurrency(exchangeCredit)}`));
      if (r.exchangeOriginalSaleNumber) push('  vs ' + r.exchangeOriginalSaleNumber);
      if (exchangeRefund > 0) {
        push(line('REFUND:', this.formatCurrency(exchangeRefund)), { bold: true });
      } else {
        push(
          line('Net Payable:', this.formatCurrency(Math.max(0, r.total - exchangeCredit))),
          { bold: true }
        );
      }
    }
    push(thin);
    push('', { blank: true });

    push('PAYMENT:');
    for (const p of r.payments) {
      const methodLabel = this.formatPaymentMethod(p.method);
      push(line(methodLabel, this.formatCurrency(p.amount)));
      if (p.referenceNumber) push('  Ref: ' + p.referenceNumber);
    }
    const amountDue = Math.max(0, r.total - exchangeCredit);
    const changeAmount = r.payments.reduce((sum, p) => sum + p.amount, 0) - amountDue;
    if (changeAmount > 0.01) {
      push(line('Change:', this.formatCurrency(changeAmount)));
    }

    if (r.loyaltyPointsEarned > 0 || r.loyaltyPointsRedeemed > 0) {
      push(thin);
      if (r.loyaltyPointsEarned > 0) {
        push(line('Points Earned:', String(r.loyaltyPointsEarned)));
      }
      if (r.loyaltyPointsRedeemed > 0) {
        push(line('Points Redeemed:', String(r.loyaltyPointsRedeemed)));
      }
    }

    // §1.2 — legend below the items if any line carries a sale-policy flag.
    const hasNonReturnable = r.items.some((i) => i.nonReturnable);
    const hasExchangeOnly = r.items.some((i) => !i.nonReturnable && i.exchangeOnly);
    if (hasNonReturnable || hasExchangeOnly) {
      push(thin);
      if (hasNonReturnable) {
        push('** NON-RETURNABLE items cannot be returned or exchanged.', { bold: true });
      }
      if (hasExchangeOnly) {
        push('** EXCHANGE ONLY items can be exchanged but not refunded.', { bold: true });
      }
    }

    push(thin);
    if (r.receiptFooter) push(r.receiptFooter, { align: 'center' });
    push('Thank you for shopping!', { align: 'center' });
    push(divider, { align: 'center' });
    return rows;
  }

  private buildRefundRows(r: any): ReceiptRow[] {
    const divider = '='.repeat(this.COLS);
    const thin = '-'.repeat(this.COLS);
    const rows: ReceiptRow[] = [];
    const push = (text: string, opts: Partial<ReceiptRow> = {}) => rows.push({ text, ...opts });
    const line = (l: string, v: string) => l + this.pad(l, v) + v;
    const title = String(r.type || 'return').toUpperCase() === 'EXCHANGE' ? 'EXCHANGE' : 'REFUND';

    push(divider, { align: 'center' });
    push(r.branchName, { align: 'center', bold: true, big: true });
    if (r.branchAddress) push(r.branchAddress, { align: 'center' });
    if (r.branchPhone) push('Phone: ' + r.branchPhone, { align: 'center' });
    push(divider, { align: 'center' });
    push(`${title} RECEIPT`, { align: 'center', bold: true });

    push(`${title} #: ${r.returnNumber}`);
    push(`Against Bill: ${r.originalSaleNumber}`);
    push(`Date: ${this.formatDate(r.date)}`);
    push(`Cashier: ${r.cashier}`);
    if (r.customer) {
      push(
        `Customer: ${r.customer.name}${r.customer.phone ? ' (' + r.customer.phone + ')' : ''}`
      );
    }
    push(thin);
    push('', { blank: true });

    push('ITEMS RETURNED:');
    for (const it of r.items || []) {
      push(it.name);
      push(`  ${it.variant}  x${it.quantity}`);
      push(line('  Tag/MRP:', this.formatCurrency(it.mrpUnit)));
      if (it.perUnitAdjustment > 0) {
        push(line('  Less adj:', '-' + this.formatCurrency(it.perUnitAdjustment)));
      }
      push(line('  Net paid:', this.formatCurrency(it.netUnit)));
      push(line('  Refund:', this.formatCurrency(it.refund)), { bold: true });
    }
    push(thin);
    push(line('TOTAL ' + title + ':', this.formatCurrency(r.refundTotal)), { bold: true });
    push(thin);

    push('REFUNDED VIA:');
    for (const b of r.refundBreakup || []) {
      push(line(this.formatPaymentMethod(b.method) + ':', this.formatCurrency(b.amount)));
    }
    if (r.loyaltyPointsRestored > 0) {
      push(line('Points returned:', String(r.loyaltyPointsRestored)));
    }
    push(thin);

    if (r.receiptFooter) push(r.receiptFooter, { align: 'center' });
    push('Refund value is derived from the net price paid,', { align: 'center' });
    push('not the tag price.', { align: 'center' });
    push(divider, { align: 'center' });
    return rows;
  }

  // ── 1-bit bitmap renderer ───────────────────────────────────────

  /**
   * Lay the rows out on a monospace grid and draw them to an offscreen canvas
   * at the printer's native dot width, then threshold every pixel to pure
   * black or white so the OS print pipeline has no grayscale to dither.
   */
  private renderRowsToBitmap(rows: ReceiptRow[]): HTMLCanvasElement {
    const width = this.DOTS;
    const marginX = 8;
    const usable = width - marginX * 2;
    const font = (px: number, bold: boolean) =>
      `${bold ? 'bold ' : ''}${px}px 'Courier New', 'Roboto Mono', monospace`;

    // Derive the font size that makes COLS monospace chars fill the usable
    // width. Monospace advance scales linearly with px, so measure once at a
    // reference size and solve.
    const measure = document.createElement('canvas').getContext('2d')!;
    const probe = 100;
    measure.font = font(probe, false);
    const wAtProbe = measure.measureText('M'.repeat(this.COLS)).width || probe * this.COLS * 0.6;
    const baseSize = Math.max(14, Math.floor((usable / wAtProbe) * probe));
    const bigSize = Math.round(baseSize * 1.35);
    const lineOf = (r: ReceiptRow) => Math.round((r.big ? bigSize : baseSize) * 1.35);
    const spacer = Math.round(baseSize * 0.6);

    // Word-wrap any row longer than the grid so nothing runs off the edge.
    const wrapped: ReceiptRow[] = [];
    for (const r of rows) {
      if (r.blank) {
        wrapped.push(r);
        continue;
      }
      const parts = this.wrap(r.text, this.COLS);
      for (const part of parts) wrapped.push({ ...r, text: part });
    }

    // Total height.
    const padTop = 12;
    const padBottom = 28;
    let height = padTop + padBottom;
    for (const r of wrapped) height += r.blank ? spacer : lineOf(r);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = padTop;
    for (const r of wrapped) {
      if (r.blank) {
        y += spacer;
        continue;
      }
      const size = r.big ? bigSize : baseSize;
      ctx.font = font(size, !!r.bold);
      let x = marginX;
      if (r.align === 'center') {
        const w = ctx.measureText(r.text).width;
        x = Math.max(marginX, Math.round((width - w) / 2));
      }
      ctx.fillText(r.text, x, y);
      y += lineOf(r);
    }

    this.thresholdToBlackWhite(ctx, width, height);
    return canvas;
  }

  /** Collapse every pixel to pure black or pure white (kills anti-alias gray). */
  private thresholdToBlackWhite(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ): void {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum < this.THRESHOLD ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Word-aware wrap to `cols` characters; hard-splits over-long tokens. */
  private wrap(text: string, cols: number): string[] {
    if (text.length <= cols) return [text];
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      if (!cur.length) cur = word;
      else if ((cur + ' ' + word).length <= cols) cur += ' ' + word;
      else {
        lines.push(cur);
        cur = word;
      }
      while (cur.length > cols) {
        lines.push(cur.slice(0, cols));
        cur = cur.slice(cols);
      }
    }
    if (cur.length) lines.push(cur);
    return lines.length ? lines : [text];
  }

  /** Open a print window showing the bitmap at native width and print it. */
  private printBitmap(canvas: HTMLCanvasElement, title: string): void {
    const dataUrl = canvas.toDataURL('image/png');
    const printWindow = window.open('', '_blank', 'width=420,height=700');
    if (!printWindow) {
      throw new Error('Pop-up blocked. Please allow pop-ups for receipt printing.');
    }
    const widthMm = this.WIDTH_MM;
    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.esc(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    /* Print the 1-bit bitmap at 1:1 with the paper; never let the browser
       resample it (pixelated/crisp-edges) so the crisp dots stay crisp. */
    img {
      display: block;
      width: ${widthMm}mm;
      height: auto;
      background: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    .actions { margin-top: 16px; display: flex; gap: 8px; }
    .actions button {
      padding: 8px 20px; font-size: 13px; border: none; border-radius: 4px;
      cursor: pointer; font-family: 'Inter', Arial, sans-serif;
    }
    .btn-print { background: #1a1a2e; color: #fff; }
    .btn-close { background: #e0e0e0; color: #333; }
    @media print {
      body { background: none; padding: 0; display: block; }
      img { box-shadow: none; width: ${widthMm}mm; }
      .actions { display: none !important; }
      @page { size: 80mm auto; margin: 0; }
    }
  </style>
</head>
<body>
  <img id="receipt" src="${dataUrl}" alt="Receipt">
  <div class="actions">
    <button class="btn-print" onclick="window.print()">Print Receipt</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>
  <script>
    (function () {
      var img = document.getElementById('receipt');
      function go() { setTimeout(function () { window.print(); }, 300); }
      if (img.complete) go(); else img.onload = go;
    })();
  <\/script>
</body>
</html>`);
    printWindow.document.close();
  }

  // ── Formatting helpers ──────────────────────────────────────────

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount || 0);
  }

  private formatDate(date: string): string {
    return new Date(date).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  private formatPaymentMethod(method: string): string {
    if (!method) return 'Payment';
    return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
  }

  /** Pad with spaces to right-align `right` on a COLS-wide monospace line. */
  private pad(left: string, right: string, width: number = this.COLS): string {
    const gap = width - left.length - right.length;
    return gap > 0 ? ' '.repeat(gap) : ' ';
  }

  /** Escape HTML entities (used only for the print-window <title>). */
  private esc(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
