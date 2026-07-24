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

@Injectable({ providedIn: 'root' })
export class ReceiptPrintService {
  constructor(private api: ApiService) {}

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

    const printWindow = window.open('', '_blank', 'width=420,height=700');
    if (!printWindow) {
      throw new Error('Pop-up blocked. Please allow pop-ups for receipt printing.');
    }

    const html = this.buildReceiptHtml(receipt);
    printWindow.document.write(html);
    printWindow.document.close();
  }

  /**
   * §1.3a — print/show the customer-facing refund/exchange breakup receipt for
   * a completed return. Opens the same print window as a sale receipt.
   */
  async printRefundReceipt(returnId: number): Promise<void> {
    const res = await firstValueFrom(
      this.api.get<{ success: boolean; data: any }>(`/sales/returns/${returnId}/receipt`)
    );
    const r = res.data;
    const printWindow = window.open('', '_blank', 'width=420,height=700');
    if (!printWindow) {
      throw new Error('Pop-up blocked. Please allow pop-ups for receipt printing.');
    }
    printWindow.document.write(this.buildRefundReceiptHtml(r));
    printWindow.document.close();
  }

  private buildRefundReceiptHtml(r: any): string {
    const divider = '========================================';
    const thin = '----------------------------------------';
    const line = (l: string, v: string) => l + this.pad(l, v) + v;

    const itemsHtml = (r.items || [])
      .map((it: any) => {
        const head = `${this.esc(it.name)}\n  ${this.esc(it.variant)}  x${it.quantity}`;
        const mrp = line('  Tag/MRP:', this.formatCurrency(it.mrpUnit));
        const adj =
          it.perUnitAdjustment > 0
            ? `\n<span class="discount">${line('  Less adj:', '-' + this.formatCurrency(it.perUnitAdjustment))}</span>`
            : '';
        const net = line('  Net paid:', this.formatCurrency(it.netUnit));
        const ref = `<strong>${line('  Refund:', this.formatCurrency(it.refund))}</strong>`;
        return `<div class="item">${head}\n${mrp}${adj}\n${net}\n${ref}</div>`;
      })
      .join('');

    const breakupHtml = (r.refundBreakup || [])
      .map((b: any) => line(this.formatPaymentMethod(b.method) + ':', this.formatCurrency(b.amount)))
      .join('\n');

    const loyaltyLine =
      r.loyaltyPointsRestored > 0
        ? `\n${line('Points returned:', String(r.loyaltyPointsRestored))}`
        : '';
    const customerLine = r.customer
      ? `Customer: ${this.esc(r.customer.name)}${r.customer.phone ? ' (' + this.esc(r.customer.phone) + ')' : ''}\n`
      : '';
    const title = String(r.type || 'return').toUpperCase() === 'EXCHANGE' ? 'EXCHANGE' : 'REFUND';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${title} - ${this.esc(r.returnNumber)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Courier New',monospace; font-size:12px; line-height:1.4; color:#000; background:#f5f5f5; display:flex; flex-direction:column; align-items:center; padding:20px; }
.receipt { width:302px; background:#fff; padding:12px 16px; white-space:pre; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
.center { text-align:center; } .store-name { font-size:16px; font-weight:bold; }
.item { margin:6px 0; } .discount { color:#888; } strong { font-weight:bold; }
.actions { margin-top:16px; display:flex; gap:8px; }
.actions button { padding:8px 20px; font-size:13px; border:none; border-radius:4px; cursor:pointer; font-family:'Inter',Arial,sans-serif; }
.btn-print { background:#1a1a2e; color:#fff; } .btn-close { background:#e0e0e0; color:#333; }
@media print { html,body { background:none; padding:0; display:block; color:#000; -webkit-font-smoothing:none; text-rendering:geometricPrecision; -webkit-print-color-adjust:exact; print-color-adjust:exact; } .receipt { box-shadow:none; width:100%; max-width:80mm; padding:2mm; font-weight:bold; color:#000; } .receipt .discount { color:#000 !important; } .actions { display:none !important; } @page { size:80mm auto; margin:0; } }
</style></head><body>
<div class="receipt"><div class="center">${divider}
<span class="store-name">${this.esc(r.branchName)}</span>
${this.esc(r.branchAddress || '')}
${r.branchPhone ? 'Phone: ' + this.esc(r.branchPhone) : ''}
${divider}
<strong>${title} RECEIPT</strong></div>
${title} #: ${this.esc(r.returnNumber)}
Against Bill: ${this.esc(r.originalSaleNumber)}
Date: ${this.formatDate(r.date)}
Cashier: ${this.esc(r.cashier)}
${customerLine}${thin}

ITEMS RETURNED:
${itemsHtml}
${thin}
<strong>${line('TOTAL ' + title + ':', this.formatCurrency(r.refundTotal))}</strong>
${thin}
REFUNDED VIA:
${breakupHtml}${loyaltyLine}
${thin}
${r.receiptFooter ? '<div class="center">' + this.esc(r.receiptFooter) + '</div>' : ''}
<div class="center">Refund value is derived from the net price paid,
not the tag price.
${divider}</div></div>
<div class="actions">
  <button class="btn-print" onclick="window.print()">Print</button>
  <button class="btn-close" onclick="window.close()">Close</button>
</div>
<script>setTimeout(function(){ window.print(); }, 500);<\/script>
</body></html>`;
  }

  private buildReceiptHtml(r: ReceiptData): string {
    const divider = '========================================';
    const thinDivider = '----------------------------------------';

    const itemsHtml = r.items
      .map((item) => {
        const variantLine = item.variant ? `  ${this.esc(item.variant)}` : '';
        const priceLine = `  ${item.quantity} x ${this.formatCurrency(item.unitPrice)}`;
        const totalStr = this.formatCurrency(item.total);
        const padded = priceLine + this.pad(priceLine, totalStr) + totalStr;
        let discountLine = '';
        if (item.discount > 0) {
          const discStr = `-${this.formatCurrency(item.discount)}`;
          const discLabel = '    Disc:';
          discountLine = `\n<span class="discount">${discLabel}${this.pad(discLabel, discStr)}${discStr}</span>`;
        }
        // Per-item loyalty points redeemed — this line's share of the bill's
        // redemption, so the customer sees which items the points came off.
        let loyaltyLine = '';
        if (item.loyaltyPointsRedeemed && item.loyaltyPointsRedeemed > 0) {
          const lpStr = `-${item.loyaltyPointsRedeemed} pts`;
          const lpLabel = '    Loyalty:';
          loyaltyLine = `\n<span class="discount">${lpLabel}${this.pad(lpLabel, lpStr)}${lpStr}</span>`;
        }
        // §1.2 — flag non-returnable / exchange-only goods on the printed bill.
        let flagLine = '';
        if (item.nonReturnable) {
          flagLine = `\n<span class="flag">  ** NON-RETURNABLE **</span>`;
        } else if (item.exchangeOnly) {
          flagLine = `\n<span class="flag">  ** EXCHANGE ONLY **</span>`;
        }
        return `<div class="item">${this.esc(item.name)}${variantLine ? '\n' + variantLine : ''}\n${padded}${discountLine}${loyaltyLine}${flagLine}</div>`;
      })
      .join('');

    // §1.2 — legend below the items if any line carries a sale-policy flag.
    const hasNonReturnable = r.items.some((i) => i.nonReturnable);
    const hasExchangeOnly = r.items.some((i) => !i.nonReturnable && i.exchangeOnly);
    let policyNote = '';
    if (hasNonReturnable || hasExchangeOnly) {
      const notes: string[] = [];
      if (hasNonReturnable) notes.push('** NON-RETURNABLE items cannot be returned or exchanged.');
      if (hasExchangeOnly) notes.push('** EXCHANGE ONLY items can be exchanged but not refunded.');
      policyNote = `\n${thinDivider}\n<span class="flag">${notes.map((t) => this.esc(t)).join('\n')}</span>`;
    }

    const subtotalLabel = 'Subtotal:';
    const subtotalVal = this.formatCurrency(r.subtotal);
    const subtotalLine = subtotalLabel + this.pad(subtotalLabel, subtotalVal) + subtotalVal;

    let discountLine = '';
    if (r.discountAmount > 0) {
      const discLabel = 'Discount:';
      const discVal = `-${this.formatCurrency(r.discountAmount)}`;
      discountLine = `\n${discLabel}${this.pad(discLabel, discVal)}${discVal}`;
    }

    // Tax line only when GST compliance is on. Carries its own leading newline so
    // that when hidden it leaves no blank line on the receipt.
    const taxLabel = 'Tax:';
    const taxVal = this.formatCurrency(r.taxAmount);
    const taxLine = this.showGst ? `\n${taxLabel}${this.pad(taxLabel, taxVal)}${taxVal}` : '';

    const totalLabel = 'TOTAL:';
    const totalVal = this.formatCurrency(r.total);
    const totalLine = `<strong>${totalLabel}${this.pad(totalLabel, totalVal)}${totalVal}</strong>`;

    // Exchange: goods returned and credited against this bill.
    const exchangeCredit = r.exchangeCredit || 0;
    const exchangeRefund = r.exchangeRefund || 0;
    let exchangeLines = '';
    if (exchangeCredit > 0) {
      const cLabel = 'Exchange credit:';
      const cVal = `-${this.formatCurrency(exchangeCredit)}`;
      let block = `\n${cLabel}${this.pad(cLabel, cVal)}${cVal}`;
      if (r.exchangeOriginalSaleNumber) {
        block += `\n  vs ${this.esc(r.exchangeOriginalSaleNumber)}`;
      }
      if (exchangeRefund > 0) {
        const rLabel = 'REFUND:';
        const rVal = this.formatCurrency(exchangeRefund);
        block += `\n<strong>${rLabel}${this.pad(rLabel, rVal)}${rVal}</strong>`;
      } else {
        const nLabel = 'Net Payable:';
        const nVal = this.formatCurrency(Math.max(0, r.total - exchangeCredit));
        block += `\n<strong>${nLabel}${this.pad(nLabel, nVal)}${nVal}</strong>`;
      }
      exchangeLines = block;
    }

    const paymentsHtml = r.payments
      .map((p) => {
        const methodLabel = this.formatPaymentMethod(p.method);
        const amtStr = this.formatCurrency(p.amount);
        let line = methodLabel + this.pad(methodLabel, amtStr) + amtStr;
        if (p.referenceNumber) {
          line += `\n  Ref: ${this.esc(p.referenceNumber)}`;
        }
        return line;
      })
      .join('\n');

    const amountDue = Math.max(0, r.total - exchangeCredit);
    const changeAmount = r.payments.reduce((sum, p) => sum + p.amount, 0) - amountDue;
    let changeLine = '';
    if (changeAmount > 0.01) {
      const changeLabel = 'Change:';
      const changeVal = this.formatCurrency(changeAmount);
      changeLine = `\n${changeLabel}${this.pad(changeLabel, changeVal)}${changeVal}`;
    }

    let loyaltySection = '';
    if (r.loyaltyPointsEarned > 0 || r.loyaltyPointsRedeemed > 0) {
      let lines = '';
      if (r.loyaltyPointsEarned > 0) {
        const earnLabel = 'Points Earned:';
        const earnVal = String(r.loyaltyPointsEarned);
        lines += earnLabel + this.pad(earnLabel, earnVal) + earnVal;
      }
      if (r.loyaltyPointsRedeemed > 0) {
        const redLabel = 'Points Redeemed:';
        const redVal = String(r.loyaltyPointsRedeemed);
        if (lines) lines += '\n';
        lines += redLabel + this.pad(redLabel, redVal) + redVal;
      }
      loyaltySection = `\n${thinDivider}\n${lines}`;
    }

    const customerLine = r.customer
      ? `Customer: ${this.esc(r.customer.name)}${r.customer.phone ? ' (' + this.esc(r.customer.phone) + ')' : ''}\n`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt - ${this.esc(r.saleNumber)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.4;
      color: #000;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }

    .receipt {
      width: 302px;
      background: #fff;
      padding: 12px 16px;
      white-space: pre;
      word-wrap: break-word;
      overflow-wrap: break-word;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .center { text-align: center; }
    .store-name { font-size: 16px; font-weight: bold; }
    .item { margin: 4px 0; }
    .discount { color: #888; }
    .flag { font-weight: bold; }
    strong { font-weight: bold; }

    .actions {
      margin-top: 16px;
      display: flex;
      gap: 8px;
    }

    .actions button {
      padding: 8px 20px;
      font-size: 13px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: 'Inter', Arial, sans-serif;
    }

    .btn-print {
      background: #1a1a2e;
      color: #fff;
    }
    .btn-print:hover { background: #16213e; }

    .btn-close {
      background: #e0e0e0;
      color: #333;
    }
    .btn-close:hover { background: #ccc; }

    @media print {
      /* Thermal heads are 1-bit: grayscale anti-aliased strokes get dithered
         into an unreadable stipple. Force pure black and a heavier weight so
         every glyph survives as solid dots (the bold TOTAL line already prints
         cleanly — this lifts the rest to the same legibility). Kept as real
         text so the on-screen/PDF copy stays crisp and resolution-independent. */
      html, body {
        background: none;
        padding: 0;
        display: block;
        color: #000;
        -webkit-font-smoothing: none;
        text-rendering: geometricPrecision;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt {
        box-shadow: none;
        width: 100%;
        max-width: 80mm;
        padding: 2mm;
        font-weight: bold;
        color: #000;
      }
      .receipt .discount { color: #000 !important; }
      .actions { display: none !important; }

      @page {
        size: 80mm auto;
        margin: 0;
      }
    }
  </style>
</head>
<body>

<div class="receipt">
<div class="center">${divider}
<span class="store-name">${this.esc(r.branchName)}</span>
${this.esc(r.branchAddress || '')}
${r.branchPhone ? 'Phone: ' + this.esc(r.branchPhone) : ''}
${divider}</div>
${r.receiptHeader ? '<div class="center">' + this.esc(r.receiptHeader) + '</div>\n' + thinDivider : ''}
Sale #: ${this.esc(r.saleNumber)}
Date: ${this.formatDate(r.date)}
Cashier: ${this.esc(r.cashier)}
${customerLine}${thinDivider}

ITEMS:
${itemsHtml}
${thinDivider}
${subtotalLine}${discountLine}${taxLine}
${thinDivider}
${totalLine}${exchangeLines}
${thinDivider}

PAYMENT:
${paymentsHtml}${changeLine}
${loyaltySection}${policyNote}
${thinDivider}
${r.receiptFooter ? '<div class="center">' + this.esc(r.receiptFooter) + '</div>' : ''}
<div class="center">Thank you for shopping!
${divider}</div>
</div>

<div class="actions">
  <button class="btn-print" onclick="window.print()">Print Receipt</button>
  <button class="btn-close" onclick="window.close()">Close</button>
</div>

<script>
  setTimeout(function() { window.print(); }, 500);
<\/script>

</body>
</html>`;
  }

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

  /** Pad with spaces to right-align value on a 40-char wide receipt line */
  private pad(left: string, right: string, width: number = 40): string {
    const gap = width - left.length - right.length;
    return gap > 0 ? ' '.repeat(gap) : ' ';
  }

  /** Escape HTML entities */
  private esc(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
