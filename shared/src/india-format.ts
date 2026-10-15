/**
 * Indian number and date formatting (dashboard spec checklist #16 and #31).
 *
 * Money is grouped the Indian way, ₹1,20,000 and not ₹120,000. Dates are shown
 * and typed as DD-MM-YYYY. Storage keeps ISO `YYYY-MM-DD` (Postgres DATE), so
 * these helpers only ever convert at the edges: what a person reads or types.
 */

const groupers = new Map<number, Intl.NumberFormat>();

function grouper(decimals: number): Intl.NumberFormat {
  let f = groupers.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    groupers.set(decimals, f);
  }
  return f;
}

/** 120000 → "1,20,000". Accepts Prisma Decimal strings as well as numbers. */
export function formatIndianNumber(value: number | string | null | undefined, decimals = 0): string {
  const n = Number(value ?? 0);
  return grouper(decimals).format(Number.isFinite(n) ? n : 0);
}

/**
 * 120000 → "₹1,20,000", −950 → "−₹950". The sign sits outside the symbol, the
 * way a bill is read aloud ("minus nine fifty"), and uses a real minus sign.
 */
export function formatInr(value: number | string | null | undefined, decimals = 0): string {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const body = grouper(decimals).format(Math.abs(safe));
  return safe < 0 && Number(body.replace(/,/g, '')) !== 0 ? `−₹${body}` : `₹${body}`;
}

/**
 * Short form for tight spaces: ₹950, ₹12.4K, ₹1.84L, ₹2.1Cr. Lakh and crore,
 * not million, because that is how the shop counts.
 */
export function formatInrCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? '−' : '';
  const a = Math.abs(safe);
  const trim = (x: number) => x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.?0+$/, '');
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Any stored date to DD-MM-YYYY. Takes an ISO day ("2026-10-15"), a full ISO
 * timestamp of a Postgres DATE (which reads back as UTC midnight), or a Date of
 * that kind. Only the calendar day is used, never converted through a time
 * zone, so a DATE column can never slide by a day.
 */
export function formatDdMmYyyy(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const ymd = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const m = YMD.exec(ymd);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * DD-MM-YYYY (also DD/MM/YYYY or DD.MM.YYYY, single-digit day or month allowed)
 * to ISO "YYYY-MM-DD". Returns null for anything that is not a real calendar
 * day, so 31-02-2026 is refused rather than rolled into March.
 */
export function parseDdMmYyyy(text: string | null | undefined): string | null {
  const m = DMY.exec((text ?? '').trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!isRealDate(y, mo, d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Dashboard spec §12.4: an imported legacy sale must carry its original date.
 * Rejects a missing date, an unparseable one, one in the future and one before
 * 01-01-2010. `today` is an ISO day, passed in so the rule stays pure.
 */
export function validateLegacySaleDate(
  text: string | null | undefined,
  today: string
): { ok: true; ymd: string } | { ok: false; error: string } {
  if (text == null || String(text).trim() === '') {
    return { ok: false, error: 'Original sale date is required' };
  }
  const ymd = parseDdMmYyyy(String(text));
  if (!ymd) return { ok: false, error: `"${text}" is not a valid DD-MM-YYYY date` };
  if (ymd > today) return { ok: false, error: `${formatDdMmYyyy(ymd)} is in the future` };
  if (ymd < '2010-01-01') return { ok: false, error: `${formatDdMmYyyy(ymd)} is before 01-01-2010` };
  return { ok: true, ymd };
}
