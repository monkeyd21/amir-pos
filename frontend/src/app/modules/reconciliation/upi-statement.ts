/**
 * Reading a bank or PSP statement export into UPI credit rows (dashboard spec
 * §15.2). Every bank lays its CSV out differently, so the columns are guessed
 * from the header and the person confirms or corrects the guess. Pure, so the
 * fiddly parts (quotes, Indian dates, "₹1,20,000.00 Cr") are unit-tested.
 */

export interface ColumnMap {
  date: number | null;
  amount: number | null;
  reference: number | null;
  payerName: number | null;
  payerVpa: number | null;
  /** Optional Cr/Dr (or credit/debit) marker column: rows that say debit are skipped. */
  direction: number | null;
}

export interface ParsedCredit {
  receivedAt: string;
  amount: number;
  reference: string;
  payerName: string | null;
  payerVpa: string | null;
}

export interface ParseResult {
  rows: ParsedCredit[];
  skipped: { line: number; reason: string }[];
}

/** RFC 4180-ish: commas, double quotes, "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) out.push(row.map((c) => c.trim()));
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) out.push(row.map((c) => c.trim()));
  return out;
}

const pick = (headers: string[], patterns: RegExp[]): number | null => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return null;
};

/** Best guess at which column is which, from the header row. */
export function guessColumns(header: string[]): ColumnMap {
  const h = header.map((x) => x.toLowerCase());
  return {
    date: pick(h, [/date.*time|time.*date/, /txn.*date|transaction.*date|value.*date/, /\bdate\b/, /time/]),
    amount: pick(h, [/credit.*amount|amount.*credit/, /^credit$/, /amount/, /\bamt\b/]),
    reference: pick(h, [/\butr\b/, /\brrn\b/, /reference|ref\.? ?no|ref id/, /transaction.*id|txn.*id/]),
    payerName: pick(h, [/payer.*name|customer.*name|sender.*name|remitter/, /\bname\b/]),
    payerVpa: pick(h, [/vpa|upi.*id|payer.*upi|sender.*upi/]),
    direction: pick(h, [/cr\/dr|dr\/cr|type|direction/]),
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A statement timestamp, read as India time, to an ISO instant. Takes
 * DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY / DD-Mon-YYYY or YYYY-MM-DD, with an
 * optional time (24-hour or with AM/PM). Day-first, because that is how
 * Indian banks write dates. Null when it cannot be read.
 */
export function parseStatementDate(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  let y: number, mo: number, d: number;
  let rest = '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/.exec(t);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4] ?? '';
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ ,]+(.*))?$/.exec(t))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    rest = m[4] ?? '';
  } else if ((m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]+(\d{2,4})(?:[ ,]+(.*))?$/.exec(t))) {
    d = Number(m[1]);
    mo = MONTHS[m[2].toLowerCase()] ?? 0;
    y = Number(m[3]);
    if (y < 100) y += 2000;
    rest = m[4] ?? '';
  } else {
    return null;
  }

  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (rest) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?/.exec(rest);
    if (!tm) return null;
    hh = Number(tm[1]);
    mm = Number(tm[2]);
    ss = Number(tm[3] ?? 0);
    const ap = tm[4]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (!mo || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  // IST is UTC+05:30 all year.
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss) - 5.5 * 3600_000).toISOString();
}

/** "₹1,20,000.50", "1200 Cr", "(500.00)" → number; negative or debit marks → negative. */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t) || /\bdr\b/i.test(t);
  const n = Number(t.replace(/[₹,()\s]|rs\.?|inr|cr|dr/gi, '').replace(/^-/, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Turn the data rows into credits, skipping (and saying why) anything that is not one. */
export function toCredits(dataRows: string[][], map: ColumnMap, firstLine = 2): ParseResult {
  const rows: ParsedCredit[] = [];
  const skipped: { line: number; reason: string }[] = [];
  if (map.date == null || map.amount == null || map.reference == null) {
    return { rows, skipped: [{ line: 0, reason: 'Pick the date, amount and reference columns' }] };
  }
  dataRows.forEach((r, i) => {
    const line = firstLine + i;
    const dir = map.direction != null ? (r[map.direction] ?? '').toLowerCase() : '';
    if (/^d|debit|dr/.test(dir)) {
      skipped.push({ line, reason: 'Debit' });
      return;
    }
    const at = parseStatementDate(r[map.date!] ?? '');
    const amount = parseAmount(r[map.amount!] ?? '');
    const reference = (r[map.reference!] ?? '').replace(/\s+/g, '');
    const problem = !at
      ? `Unreadable date "${r[map.date!] ?? ''}"`
      : amount == null
      ? 'No amount'
      : amount <= 0
      ? 'Not a credit'
      : reference.length < 4
      ? 'No reference / UTR'
      : null;
    if (problem || !at || amount == null) {
      skipped.push({ line, reason: problem ?? 'Unreadable' });
      return;
    }
    rows.push({
      receivedAt: at,
      amount: Math.round(amount * 100) / 100,
      reference,
      payerName: map.payerName != null ? r[map.payerName] || null : null,
      payerVpa: map.payerVpa != null ? r[map.payerVpa] || null : null,
    });
  });
  return { rows, skipped };
}
