import * as bwipjs from 'bwip-js';

export interface UpiConfig {
  /** Payee Virtual Payment Address, e.g. "store@ybl" or "9123456789@upi". */
  vpa: string;
  /** Name shown to the customer during payment (defaults to the store name). */
  merchantName: string;
}

export const DEFAULT_UPI_CONFIG: UpiConfig = { vpa: '', merchantName: '' };

/**
 * Build a UPI "pay" deep link (upi://pay?...). When `amount` > 0 it is embedded
 * as `am=`, so the customer's UPI app pre-fills the exact bill amount ("scan to
 * pay a fixed amount"). `pa` (the VPA) is kept raw — UPI apps expect the `@`
 * unencoded; only the free-text name/note are percent-encoded.
 */
export function buildUpiUri(opts: { vpa: string; name?: string; amount?: number; note?: string }): string {
  const q = [`pa=${opts.vpa}`];
  if (opts.name) q.push(`pn=${encodeURIComponent(opts.name)}`);
  if (opts.amount != null && opts.amount > 0) q.push(`am=${opts.amount.toFixed(2)}`);
  q.push('cu=INR');
  if (opts.note) q.push(`tn=${encodeURIComponent(opts.note)}`);
  return `upi://pay?${q.join('&')}`;
}

/** Render a UPI link as a QR-code PNG buffer (for PDF receipts). */
export async function upiQrPng(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: 'qrcode', text, scale: 4 });
}

/** Render a UPI link as a data-URL QR code (for embedding in HTML receipts). */
export async function upiQrDataUrl(text: string): Promise<string> {
  const png = await upiQrPng(text);
  return `data:image/png;base64,${png.toString('base64')}`;
}
