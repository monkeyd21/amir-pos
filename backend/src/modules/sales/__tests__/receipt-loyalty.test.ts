import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';
import {
  LedgerMovement,
  loyaltyReceiptRows,
  pointsBalanceAfterSale,
} from '../receipt-loyalty';

/**
 * A bill prints the points the customer walks out with, and a reprint months
 * later must still print THAT number — not whatever the wallet holds today.
 * `Customer.loyaltyPoints` is a live running balance, so the receipt rewinds it
 * over the ledger back to the moment of the sale. These lock down both the
 * rewind and the rule about which loyalty lines a bill shows at all.
 */

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
});

const SALE_ID = 1;

/** A ledger row, oldest-first ids the way the query returns them. */
const mv = (
  id: number,
  points: number,
  over: Partial<LedgerMovement> = {}
): LedgerMovement => ({ id, points, saleId: null, type: 'adjusted', ...over });

/** The rows this sale's own checkout wrote. */
const earned = (id: number, points: number) => mv(id, points, { saleId: SALE_ID, type: 'earned' });
const redeemed = (id: number, points: number) =>
  mv(id, -points, { saleId: SALE_ID, type: 'redeemed' });

describe('receipt loyalty balance', () => {
  describe('pointsBalanceAfterSale', () => {
    it('prints the live wallet when nothing has moved since — the original print', () => {
      // The common case: the bill is printed seconds after checkout, so the
      // live balance IS the walk-out balance.
      expect(pointsBalanceAfterSale(430, SALE_ID, [earned(9, 30)])).toBe(430);
    });

    it('rewinds points earned on a later bill, so the reprint is unchanged', () => {
      // Same sale, reprinted after the customer shopped again and earned 70.
      // The wallet now says 500; this bill still says 430.
      const ledger = [earned(9, 30), mv(14, 70, { saleId: 2, type: 'earned' })];
      expect(pointsBalanceAfterSale(500, SALE_ID, ledger)).toBe(430);
    });

    it('rewinds a later redemption, which pushes the printed balance back up', () => {
      // The customer has since spent 200 points, so today's wallet is lower
      // than what this bill handed them.
      const ledger = [earned(9, 30), mv(21, -200, { saleId: 3, type: 'redeemed' })];
      expect(pointsBalanceAfterSale(230, SALE_ID, ledger)).toBe(430);
    });

    it('rewinds a return against THIS bill — it happened after the bill was handed over', () => {
      // A return writes its restore/claw-back under the same saleId but as
      // 'adjusted', which is why the cut is on the checkout rows only.
      const ledger = [earned(9, 30), mv(33, -30, { saleId: SALE_ID, type: 'adjusted' })];
      expect(pointsBalanceAfterSale(400, SALE_ID, ledger)).toBe(430);
    });

    it('cuts after the LAST checkout row when the bill both earned and redeemed', () => {
      const ledger = [redeemed(8, 100), earned(9, 30), mv(12, 50, { saleId: 4, type: 'earned' })];
      expect(pointsBalanceAfterSale(480, SALE_ID, ledger)).toBe(430);
    });

    it('rewinds everything since the sale when the bill moved no points at all', () => {
      // No checkout row to cut on (nothing earned, nothing redeemed), so every
      // movement from the sale's instant onwards is later movement.
      const ledger = [mv(40, 60, { saleId: 7, type: 'earned' })];
      expect(pointsBalanceAfterSale(210, SALE_ID, ledger)).toBe(150);
    });

    it('never prints a negative balance', () => {
      // Defensive: a ledger row without a matching wallet mutation (legacy or
      // hand-patched data) must not print "-20 points".
      expect(pointsBalanceAfterSale(0, SALE_ID, [mv(50, 20, { saleId: 9 })])).toBe(0);
    });
  });

  describe('loyaltyReceiptRows', () => {
    it('prints nothing for a walk-in bill', () => {
      // No customer means no balance at all — never "0 points available".
      expect(
        loyaltyReceiptRows({
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 0,
          loyaltyPointsBalance: null,
        })
      ).toEqual([]);
    });

    it('prints nothing for a customer with no points in play', () => {
      expect(
        loyaltyReceiptRows({
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 0,
          loyaltyPointsBalance: 0,
        })
      ).toEqual([]);
    });

    it('prints the balance beside the points earned', () => {
      expect(
        loyaltyReceiptRows({
          loyaltyPointsEarned: 30,
          loyaltyPointsRedeemed: 0,
          loyaltyPointsBalance: 430,
        })
      ).toEqual([
        ['Points Earned', '30'],
        ['Points Balance', '430'],
      ]);
    });

    it('prints a zero balance once the block is showing', () => {
      // The customer just spent the lot: "none left" is the honest answer.
      expect(
        loyaltyReceiptRows({
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 200,
          loyaltyPointsBalance: 0,
        })
      ).toEqual([
        ['Points Redeemed', '200'],
        ['Points Balance', '0'],
      ]);
    });

    it('prints the balance alone for a customer who neither earned nor redeemed', () => {
      expect(
        loyaltyReceiptRows({
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 0,
          loyaltyPointsBalance: 150,
        })
      ).toEqual([['Points Balance', '150']]);
    });
  });

  // ─── GET /:id/receipt ───────────────────────────────────────
  describe('GET /:id/receipt', () => {
    const receiptSale = (over: any = {}) => ({
      id: SALE_ID,
      saleNumber: 'SL-TEST-001',
      subtotal: 1000,
      taxAmount: 0,
      discountAmount: 0,
      total: 1000,
      loyaltyPointsEarned: 30,
      loyaltyPointsRedeemed: 0,
      exchangeCreditAmount: 0,
      exchangeReturnId: null,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      businessDate: null,
      branch: { id: 1, name: 'Main', address: null, phone: null, receiptHeader: null, receiptFooter: null, returnPolicy: null },
      customer: { id: 5, firstName: 'Asha', lastName: 'Patel', phone: '9876543210', loyaltyPoints: 430 },
      user: { id: 3, firstName: 'John', lastName: 'Doe' },
      items: [
        {
          quantity: 1,
          unitPrice: 1000,
          discount: 0,
          taxAmount: 0,
          total: 1000,
          mrp: null,
          variant: { size: 'M', color: 'Blue', sku: 'SKU-1', mrpOverride: null, product: { name: 'Kurta', mrp: null, basePrice: null } },
        },
      ],
      payments: [{ method: 'cash', amount: 1000, referenceNumber: null }],
      ...over,
    });

    it('returns the balance the customer walks out with', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(receiptSale());
      prismaMock.loyaltyTransaction.findMany.mockResolvedValue([
        { id: 9, points: 30, saleId: SALE_ID, type: 'earned' },
      ]);

      const res = await request(app)
        .get(`/api/v1/sales/${SALE_ID}/receipt`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.loyaltyPointsEarned).toBe(30);
      expect(res.body.data.loyaltyPointsBalance).toBe(430);
    });

    it('is unchanged by a later bill — the reprint stays faithful', async () => {
      // The wallet has since grown to 500 on a later sale.
      prismaMock.sale.findUnique.mockResolvedValue(
        receiptSale({
          customer: { id: 5, firstName: 'Asha', lastName: 'Patel', phone: '9876543210', loyaltyPoints: 500 },
        })
      );
      prismaMock.loyaltyTransaction.findMany.mockResolvedValue([
        { id: 9, points: 30, saleId: SALE_ID, type: 'earned' },
        { id: 14, points: 70, saleId: 2, type: 'earned' },
      ]);

      const res = await request(app)
        .get(`/api/v1/sales/${SALE_ID}/receipt`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.loyaltyPointsBalance).toBe(430);
    });

    it('carries no balance on a walk-in bill', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(
        receiptSale({ customer: null, loyaltyPointsEarned: 0 })
      );

      const res = await request(app)
        .get(`/api/v1/sales/${SALE_ID}/receipt`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.loyaltyPointsBalance).toBeNull();
      // No customer, no ledger lookup.
      expect(prismaMock.loyaltyTransaction.findMany).not.toHaveBeenCalled();
    });
  });
});
