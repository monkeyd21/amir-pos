import { computeMrpTotals, lineMrpPerUnit, ReceiptSale } from '../receipt-pdf';

/**
 * The bill reads the way an Indian retail bill does: the subtotal is the MRP
 * total and the markdown down to the charged Sale Price is an explicit line, so
 * `Subtotal − Price saving − Discount = TOTAL`.
 *
 * The whole point is that this is presentation only. `totalMrp − saving` must
 * come back to the stored `sale.subtotal` on every cart, so the money charged
 * never moves. These lock that in, along with the MRP floor that keeps a
 * missing or stale tag from printing a negative saving.
 */

type Item = ReceiptSale['items'][number];

const item = (over: Partial<Item> & { mrp?: number | string | null } = {}): Item =>
  ({
    quantity: 1,
    unitPrice: 670,
    total: 670,
    ...over,
    variant: {
      size: '18-24M',
      color: 'Blue',
      sku: '3743',
      mrpOverride: null,
      product: { name: 'EMB CORD', mrp: null, basePrice: null },
      ...(over.variant ?? {}),
    },
  }) as Item;

/** A sale whose stored subtotal is the gross of what was actually charged, the
 *  way checkout persists it (Σ unitPrice × qty). */
const sale = (items: Item[], over: Partial<ReceiptSale> = {}): ReceiptSale =>
  ({
    items,
    subtotal: items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0),
    discountAmount: 0,
    taxAmount: 0,
    total: 0,
    ...over,
  }) as ReceiptSale;

describe('receipt MRP subtotal', () => {
  describe('lineMrpPerUnit', () => {
    it('prefers the MRP snapshotted on the SaleItem over a repriced variant', () => {
      // The tag as it was on the day of sale wins, even if the variant has since
      // been repriced. That snapshot is the whole reason the column exists.
      expect(
        lineMrpPerUnit(
          item({
            mrp: 750,
            variant: {
              size: '18-24M',
              color: 'Blue',
              sku: '3743',
              mrpOverride: 999,
              product: { name: 'EMB CORD', mrp: 888, basePrice: 777 },
            },
          } as Partial<Item>)
        )
      ).toBe(750);
    });

    it('falls back variant → product → the charged price on a pre-snapshot row', () => {
      const withVariant = item({
        variant: {
          size: 'M',
          color: 'Red',
          sku: 'V1',
          mrpOverride: 900,
          product: { name: 'Kurta', mrp: 800, basePrice: 700 },
        },
      } as Partial<Item>);
      expect(lineMrpPerUnit(withVariant)).toBe(900);

      const withProduct = item({
        variant: {
          size: 'M',
          color: 'Red',
          sku: 'V1',
          mrpOverride: null,
          product: { name: 'Kurta', mrp: 800, basePrice: 700 },
        },
      } as Partial<Item>);
      expect(lineMrpPerUnit(withProduct)).toBe(800);

      // No MRP anywhere: the tag price is the charged price. It must NOT read
      // product.basePrice: that is a Sale Price template (CLAUDE.md §3), and
      // treating it as a tag printed a saving the shelf never carried.
      const withNothing = item({
        unitPrice: 150,
        variant: {
          size: 'M',
          color: 'Red',
          sku: 'V1',
          mrpOverride: null,
          product: { name: 'Kurta', mrp: null, basePrice: 3999 },
        },
      } as Partial<Item>);
      expect(lineMrpPerUnit(withNothing)).toBe(150);
    });

    it('reads Prisma Decimal strings as numbers', () => {
      // Decimal columns arrive as strings like "750" over JSON; unwrapped they
      // would concatenate rather than add.
      const line = item({ mrp: '750', unitPrice: '670' } as Partial<Item>);
      expect(lineMrpPerUnit(line)).toBe(750);
      const { totalMrp, saving } = computeMrpTotals(sale([line], { subtotal: '670' }));
      expect(totalMrp).toBe(750);
      expect(saving).toBe(80);
    });
  });

  describe('computeMrpTotals', () => {
    it('an ordinary marked-down line: subtotal is the MRP, saving is the gap', () => {
      // The reported case: EMB CORD, MRP 750, charged 670.
      const s = sale([item({ mrp: 750, unitPrice: 670, total: 670 })]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 750, saving: 80 });
      // And the arithmetic closes back onto what was charged.
      expect(computeMrpTotals(s).totalMrp - computeMrpTotals(s).saving).toBe(Number(s.subtotal));
    });

    it('multiplies by quantity on both sides', () => {
      const s = sale([item({ mrp: 750, unitPrice: 670, quantity: 3, total: 2010 })]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 2250, saving: 240 });
    });

    it('a clearance line counts its full MRP against the fixed clearance price', () => {
      const s = sale([
        item({ mrp: 1200, unitPrice: 499, total: 499, isClearance: true } as Partial<Item>),
      ]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 1200, saving: 701 });
    });

    it('a line with no MRP anywhere shows no saving', () => {
      // Floored at the charged price, so the subtotal is just what was charged.
      const s = sale([item({ unitPrice: 670, total: 670 })]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 670, saving: 0 });
    });

    it('a stale MRP below the charged price can never go negative', () => {
      const s = sale([item({ mrp: 500, unitPrice: 670, total: 670 })]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 670, saving: 0 });
    });

    it('a cart sold entirely at MRP shows no saving line at all', () => {
      const s = sale([
        item({ mrp: 500, unitPrice: 500, total: 500 }),
        item({ mrp: 250, unitPrice: 250, quantity: 2, total: 500 }),
      ]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 1000, saving: 0 });
    });

    it('a mixed cart: only the marked-down lines contribute a saving', () => {
      const s = sale([
        item({ mrp: 750, unitPrice: 670, total: 670 }), // marked down
        item({ mrp: 1200, unitPrice: 499, total: 499, isClearance: true } as Partial<Item>),
        item({ mrp: 300, unitPrice: 300, quantity: 2, total: 600 }), // at MRP
        item({ unitPrice: 150, total: 150 }), // no MRP at all
      ]);
      expect(computeMrpTotals(s)).toEqual({ totalMrp: 750 + 1200 + 600 + 150, saving: 80 + 701 });
    });
  });

  describe('the money must not move', () => {
    /** Every cart shape the till sees, charged and discounted as it is today. */
    const carts: Array<{ name: string; sale: ReceiptSale }> = [
      {
        name: 'single marked-down line, no discount',
        sale: sale([item({ mrp: 750, unitPrice: 670, total: 670 })], {
          discountAmount: 0,
          total: 670,
        }),
      },
      {
        name: 'marked-down line with a bill discount on top',
        sale: sale([item({ mrp: 750, unitPrice: 670, quantity: 2, total: 1340 })], {
          discountAmount: 140,
          total: 1200,
        }),
      },
      {
        name: 'clearance line, no discount (clearance is locked from bill discount)',
        sale: sale(
          [item({ mrp: 1200, unitPrice: 499, total: 499, isClearance: true } as Partial<Item>)],
          { discountAmount: 0, total: 499 }
        ),
      },
      {
        name: 'no MRP anywhere',
        sale: sale([item({ unitPrice: 670, total: 670 })], { discountAmount: 0, total: 670 }),
      },
      {
        name: 'everything at MRP',
        sale: sale([item({ mrp: 500, unitPrice: 500, total: 500 })], {
          discountAmount: 50,
          total: 450,
        }),
      },
      {
        name: 'mixed cart with a discount',
        sale: sale(
          [
            item({ mrp: 750, unitPrice: 670, total: 670 }),
            item({ mrp: 1200, unitPrice: 499, total: 499, isClearance: true } as Partial<Item>),
            item({ mrp: 300, unitPrice: 300, quantity: 2, total: 600 }),
            item({ unitPrice: 150, total: 150 }),
          ],
          { discountAmount: 119, total: 1800 }
        ),
      },
    ];

    it.each(carts)('$name: printed subtotal chain lands on the stored total', ({ sale: s }) => {
      const { totalMrp, saving } = computeMrpTotals(s);

      // What the bill now prints as its subtotal, less the new saving line, is
      // exactly the charged gross that was stored at checkout.
      expect(totalMrp - saving).toBeCloseTo(Number(s.subtotal), 2);

      // So the bill's own arithmetic still lands on the stored total, rupee for
      // rupee, with the new row in place.
      expect(totalMrp - saving - Number(s.discountAmount)).toBeCloseTo(Number(s.total), 2);

      // And the saving line is never negative, so it can only ever be hidden.
      expect(saving).toBeGreaterThanOrEqual(0);
    });

    it('leaves "You Saved" measuring the whole way down to the total', () => {
      // The two figures are different on purpose: Price saving stops at the Sale
      // Price, You Saved runs past every bill-level discount.
      const s = sale([item({ mrp: 750, unitPrice: 670, total: 670 })], {
        discountAmount: 70,
        total: 600,
      });
      const { totalMrp, saving } = computeMrpTotals(s);
      expect(saving).toBe(80);
      expect(totalMrp - Number(s.total)).toBe(150);
    });
  });
});
