import { reconcileCommissionsForSale } from '../commission-reconcile';

// §9.1 — commission auto-adjusts on return/exchange to the net retained sale,
// re-settling the earner's whole business day under the daily threshold.
jest.mock('../../modules/settings/service', () => ({
  getSetting: jest.fn().mockResolvedValue('item_level'),
}));
jest.mock('../audit', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

const DAY = new Date('2026-08-04T00:00:00.000Z');

/**
 * `existing` is returned for every commission.findMany (seed + day scope).
 * `daySales` is the business day's sales (defaults to the single mocked sale).
 */
function mockTx(existing: any[], sale: any, daySales?: any[]) {
  return {
    commission: {
      findMany: jest.fn().mockResolvedValue(existing),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    sale: {
      findUnique: jest.fn().mockResolvedValue(
        sale ? { businessDate: DAY, createdAt: DAY } : null
      ),
      findMany: jest.fn().mockResolvedValue(daySales ?? (sale ? [sale] : [])),
    },
  } as any;
}

describe('§9.1 reconcileCommissionsForSale (item-level)', () => {
  it('zeroes the commission when the whole line is returned', async () => {
    const existing = [{ id: 9, userId: 2, saleId: 143, amount: 400, rate: 10, status: 'pending' }];
    const sale = {
      id: 143,
      userId: 1,
      total: 4000,
      user: { id: 1, commissionRate: 0 },
      items: [{ agentId: 2, agent: { id: 2, commissionRate: 10 }, quantity: 1, returnedQuantity: 1, total: 4000 }],
      returns: [],
    };
    const tx = mockTx(existing, sale);

    await reconcileCommissionsForSale(tx, 143, 1, 1);

    // Over-paid pending row removed; nothing new created (target = 0).
    expect(tx.commission.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [9] } } });
    expect(tx.commission.create).not.toHaveBeenCalled();
  });

  it('reduces the commission to the retained portion on a partial return', async () => {
    const existing = [{ id: 9, userId: 2, saleId: 143, amount: 800, rate: 10, status: 'pending' }];
    const sale = {
      id: 143,
      userId: 1,
      total: 8000,
      user: { id: 1, commissionRate: 0 },
      // 2 sold, 1 returned → half retained → commission halves (800 → 400).
      items: [{ agentId: 2, agent: { id: 2, commissionRate: 10 }, quantity: 2, returnedQuantity: 1, total: 8000 }],
      returns: [],
    };
    const tx = mockTx(existing, sale);

    await reconcileCommissionsForSale(tx, 143, 1, 1);

    expect(tx.commission.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [9] } } });
    expect(tx.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 2, amount: 400, status: 'pending' }),
      })
    );
  });

  it('does nothing when no commission has been calculated yet', async () => {
    const tx = mockTx([], null);
    await reconcileCommissionsForSale(tx, 143, 1, 1);
    expect(tx.commission.deleteMany).not.toHaveBeenCalled();
    expect(tx.commission.create).not.toHaveBeenCalled();
  });

  it('applies the daily threshold across the whole day and re-settles every bill', async () => {
    // Agent 2: ₹2,000/day threshold at 1%. Two ₹1,500 bills → day base ₹3,000 →
    // commissionable ₹1,000 → factor 1/3 → each bill earns 1500 × 1/3 × 1% = ₹5.
    const mkSale = (id: number) => ({
      id,
      userId: 1,
      total: 1500,
      user: { id: 1, commissionRate: 0 },
      items: [
        {
          agentId: 2,
          agent: { id: 2, commissionRate: 1, commissionThreshold: 2000 },
          quantity: 1,
          returnedQuantity: 0,
          total: 1500,
        },
      ],
      returns: [],
    });
    // Pre-existing (wrong) rows with no threshold applied: 1500 × 1% = ₹15 each.
    const existing = [
      { id: 1, userId: 2, saleId: 101, amount: 15, rate: 1, status: 'pending' },
      { id: 2, userId: 2, saleId: 102, amount: 15, rate: 1, status: 'pending' },
    ];
    const tx = mockTx(existing, mkSale(101), [mkSale(101), mkSale(102)]);

    await reconcileCommissionsForSale(tx, 101, 1, 1);

    // Both bills of the day re-settled to ₹5 (not just the triggering sale).
    expect(tx.commission.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
    expect(tx.commission.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
    expect(tx.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 2, saleId: 101, amount: 5 }) })
    );
    expect(tx.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 2, saleId: 102, amount: 5 }) })
    );
  });
});
