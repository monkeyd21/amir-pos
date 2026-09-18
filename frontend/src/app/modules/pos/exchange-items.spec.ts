import { buildExchangeItems } from './exchange-items';

/**
 * Bill W0215 as production actually stored it: one ordinary line and one
 * clearance line. The clearance line carries `nonReturnable: true` because
 * checkout sets it there to gate REFUNDS, and it has never meant "cannot be
 * swapped" (§2.4). The shop reported the clearance line missing from the POS
 * exchange picker; this is that bill.
 */
const W0215_ITEMS = [
  {
    id: 386,
    quantity: 1,
    returnedQuantity: 0,
    isClearance: false,
    nonReturnable: false,
    total: '549.76',
    variant: { size: 'M', color: 'Red', sku: 'DX-6-36', barcode: '100386', product: { name: 'DIAMOND X 6-36' } },
  },
  {
    id: 387,
    quantity: 1,
    returnedQuantity: 0,
    isClearance: true,
    nonReturnable: true,
    total: '500',
    variant: { size: 'L', color: 'Blue', sku: 'NPC-1', barcode: '100387', product: { name: 'NEW PKT CORD' } },
  },
];

describe('buildExchangeItems', () => {
  it('offers the clearance line on bill W0215 even though it is flagged nonReturnable', () => {
    const items = buildExchangeItems(W0215_ITEMS);

    expect(items.map((i) => i.saleItemId)).toEqual([386, 387]);
    const clearance = items.find((i) => i.saleItemId === 387)!;
    expect(clearance.productName).toBe('NEW PKT CORD');
    expect(clearance.isClearance).toBeTrue();
    expect(clearance.available).toBe(1);
    expect(clearance.unitPrice).toBe(500);
  });

  it('still hides a line the cashier flagged as-is at the counter', () => {
    const items = buildExchangeItems([
      { ...W0215_ITEMS[0], id: 1, isClearance: false, nonReturnable: true },
    ]);
    expect(items).toEqual([]);
  });

  it('still hides a line whose PRODUCT never comes back', () => {
    const items = buildExchangeItems([
      {
        ...W0215_ITEMS[1],
        id: 2,
        variant: { ...W0215_ITEMS[1].variant, product: { name: 'Innerwear', nonReturnable: true } },
      },
    ]);
    expect(items).toEqual([]);
  });

  it('hides a line already returned in full', () => {
    const items = buildExchangeItems([{ ...W0215_ITEMS[1], id: 3, quantity: 1, returnedQuantity: 1 }]);
    expect(items).toEqual([]);
  });

  it('preselects a scanned line at one unit and leaves the rest at full quantity', () => {
    const items = buildExchangeItems(
      [{ ...W0215_ITEMS[1], quantity: 3, returnedQuantity: 0, total: '1500' }],
      387
    );
    expect(items[0].selected).toBeTrue();
    expect(items[0].quantity).toBe(1);
    expect(items[0].available).toBe(3);
    expect(items[0].unitPrice).toBe(500);
  });
});
