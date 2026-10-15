/**
 * Dashboard spec §15.5: every UPI credit should be explained by a bill or a
 * pending sale. This decides which credits can be matched WITHOUT a person.
 *
 * Pure, so the rules are tested without a database. The rule is deliberately
 * conservative: a wrong automatic match hides an unbilled sale, which is the
 * very thing this exists to surface, while a missed one only costs a tap.
 *
 * 1. Same UTR / reference number as a bill's UPI payment: certain.
 * 2. Same amount, received within `windowMinutes` of a bill's UPI payment,
 *    and unambiguous both ways: the credit has exactly one such payment AND
 *    that payment has exactly one such credit. Two ₹1,200 kurtis paid by UPI
 *    four minutes apart stay unmatched for a person to pair.
 * 3. The same, against pending sales taken by UPI (same trading day).
 */

export interface CreditIn {
  id: number;
  amount: number;
  reference: string;
  receivedAt: Date;
}

export interface PaymentIn {
  id: number;
  saleId: number;
  amount: number;
  referenceNumber: string | null;
  createdAt: Date;
}

export interface PendingIn {
  id: number;
  amount: number;
  createdAt: Date;
}

export type AutoMatch =
  | { creditId: number; kind: 'payment'; paymentId: number; saleId: number; method: 'reference' | 'amount_time' }
  | { creditId: number; kind: 'pending'; pendingSaleId: number; method: 'amount_time' };

const normalise = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function autoMatch(
  credits: CreditIn[],
  payments: PaymentIn[],
  pendings: PendingIn[],
  windowMinutes = 30,
  pendingWindowMinutes = 12 * 60
): AutoMatch[] {
  const out: AutoMatch[] = [];
  const usedPayments = new Set<number>();
  const usedPendings = new Set<number>();
  const matchedCredits = new Set<number>();

  // 1. Reference numbers.
  const byRef = new Map<string, PaymentIn>();
  for (const p of payments) {
    const ref = normalise(p.referenceNumber);
    if (ref.length >= 6) byRef.set(ref, p);
  }
  for (const c of credits) {
    const p = byRef.get(normalise(c.reference));
    if (p && !usedPayments.has(p.id) && sameMoney(p.amount, c.amount)) {
      out.push({ creditId: c.id, kind: 'payment', paymentId: p.id, saleId: p.saleId, method: 'reference' });
      usedPayments.add(p.id);
      matchedCredits.add(c.id);
    }
  }

  // 2. Amount and time, unambiguous in both directions.
  const near = (a: Date, b: Date, mins: number) => Math.abs(a.getTime() - b.getTime()) <= mins * 60_000;
  const open = credits.filter((c) => !matchedCredits.has(c.id));
  const freePayments = payments.filter((p) => !usedPayments.has(p.id));
  const creditCands = new Map<number, PaymentIn[]>();
  const paymentCands = new Map<number, number>();
  for (const c of open) {
    const cands = freePayments.filter((p) => sameMoney(p.amount, c.amount) && near(p.createdAt, c.receivedAt, windowMinutes));
    creditCands.set(c.id, cands);
    for (const p of cands) paymentCands.set(p.id, (paymentCands.get(p.id) ?? 0) + 1);
  }
  for (const c of open) {
    const cands = creditCands.get(c.id)!;
    if (cands.length === 1 && paymentCands.get(cands[0].id) === 1) {
      out.push({ creditId: c.id, kind: 'payment', paymentId: cands[0].id, saleId: cands[0].saleId, method: 'amount_time' });
      usedPayments.add(cands[0].id);
      matchedCredits.add(c.id);
    }
  }

  // 3. Pending sales taken by UPI.
  const stillOpen = credits.filter((c) => !matchedCredits.has(c.id));
  const pendCands = new Map<number, PendingIn[]>();
  const pendCount = new Map<number, number>();
  for (const c of stillOpen) {
    const cands = pendings.filter(
      (p) => !usedPendings.has(p.id) && sameMoney(p.amount, c.amount) && near(p.createdAt, c.receivedAt, pendingWindowMinutes)
    );
    pendCands.set(c.id, cands);
    for (const p of cands) pendCount.set(p.id, (pendCount.get(p.id) ?? 0) + 1);
  }
  for (const c of stillOpen) {
    const cands = pendCands.get(c.id)!;
    if (cands.length === 1 && pendCount.get(cands[0].id) === 1) {
      out.push({ creditId: c.id, kind: 'pending', pendingSaleId: cands[0].id, method: 'amount_time' });
      usedPendings.add(cands[0].id);
    }
  }

  return out;
}
