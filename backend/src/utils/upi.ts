import * as bwipjs from 'bwip-js';

/**
 * bug3 — the store may collect on more than one UPI account.
 *
 * This started as a single `{ vpa, merchantName }` used only to print a QR on
 * the receipt, i.e. after the customer had already paid. The counter actually
 * needs it the other way round: pick which account to collect into, show the
 * QR while the customer is standing there, then settle the bill. So the config
 * is a list, one entry is the default, and the POS may override that per bill.
 */
export interface UpiAccount {
  /** Stable key used by the POS to pick an account. Slug of the label. */
  id: string;
  /** What the cashier sees, e.g. "Shop HDFC" or "Owner GPay". */
  label: string;
  /** Payee Virtual Payment Address, e.g. "store@ybl" or "9123456789@upi". */
  vpa: string;
  /** Name shown to the customer during payment (defaults to the store name). */
  merchantName: string;
  /** Exactly one account is the default; it is what receipts and a fresh
   *  payment screen use before the cashier chooses otherwise. */
  isDefault: boolean;
  /** Retired accounts stay for history but are not offered at the counter. */
  active: boolean;
}

export interface UpiConfig {
  accounts: UpiAccount[];
}

/** Legacy single-account shape, still what is stored in prod before this ships. */
interface LegacyUpiConfig {
  vpa?: string;
  merchantName?: string;
}

export const DEFAULT_UPI_CONFIG: UpiConfig = { accounts: [] };

export function slugifyAccountId(label: string, fallback: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/**
 * Accept either shape and always hand back the list form.
 *
 * The stored setting is a plain JSON blob with no migration attached, so the
 * old `{ vpa, merchantName }` object is still sitting in prod and in any
 * environment that has not saved UPI settings since. Reading through this
 * keeps those working — the single VPA simply becomes a one-entry list marked
 * default — rather than silently losing the store's payment address the first
 * time a receipt is printed after deploy.
 */
export function normaliseUpiConfig(raw: unknown): UpiConfig {
  if (!raw || typeof raw !== 'object') return { accounts: [] };

  const asNew = raw as Partial<UpiConfig>;
  if (Array.isArray(asNew.accounts)) {
    const accounts = asNew.accounts
      .filter((a): a is UpiAccount => !!a && typeof a === 'object' && !!String(a.vpa ?? '').trim())
      .map((a, i) => ({
        id: String(a.id ?? '').trim() || slugifyAccountId(String(a.label ?? ''), `upi-${i + 1}`),
        label: String(a.label ?? '').trim() || `UPI ${i + 1}`,
        vpa: String(a.vpa).trim(),
        merchantName: String(a.merchantName ?? '').trim(),
        isDefault: Boolean(a.isDefault),
        active: a.active !== false,
      }));
    return { accounts: ensureSingleDefault(accounts) };
  }

  const legacy = raw as LegacyUpiConfig;
  const vpa = String(legacy.vpa ?? '').trim();
  if (!vpa) return { accounts: [] };
  return {
    accounts: [
      {
        id: 'primary',
        label: 'Primary',
        vpa,
        merchantName: String(legacy.merchantName ?? '').trim(),
        isDefault: true,
        active: true,
      },
    ],
  };
}

/**
 * Exactly one active account must be the default, otherwise the receipt and a
 * fresh payment screen have nothing to fall back to. If the caller marked
 * several (or none), the first active one wins.
 */
export function ensureSingleDefault(accounts: UpiAccount[]): UpiAccount[] {
  const active = accounts.filter((a) => a.active);
  if (active.length === 0) return accounts.map((a) => ({ ...a, isDefault: false }));
  const chosen = active.find((a) => a.isDefault) ?? active[0];
  return accounts.map((a) => ({ ...a, isDefault: a === chosen }));
}

/** The account to collect into when the cashier has not picked one. */
export function defaultUpiAccount(cfg: UpiConfig): UpiAccount | null {
  return cfg.accounts.find((a) => a.active && a.isDefault) ?? cfg.accounts.find((a) => a.active) ?? null;
}

/** Look up a specific account, falling back to the default when absent. */
export function resolveUpiAccount(cfg: UpiConfig, id?: string | null): UpiAccount | null {
  if (id) {
    const found = cfg.accounts.find((a) => a.id === id && a.active);
    if (found) return found;
  }
  return defaultUpiAccount(cfg);
}

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
