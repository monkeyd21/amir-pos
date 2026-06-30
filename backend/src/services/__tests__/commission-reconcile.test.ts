import { reconcileCommissionsForSale } from '../commission-reconcile';

// §9.1 — commission auto-adjusts on return/exchange to the net retained sale.
jest.mock('../../modules/settings/service', () => ({
  getSetting: jest.fn().mockResolvedValue('item_level'),
}));
jest.mock('../audit', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

function mockTx(existing: any[], sale: any) {
  return {
    commission: {
      findMany: jest.fn().mockResolvedValue(existing),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    sale: { findUnique: jest.fn().mockResolvedValue(sale) },
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
});
