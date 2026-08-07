import { reconcileCommissionsForSale } from '../commission-reconcile';

// §9.1 — commission is paid on GROSS sold value; returns/exchanges never reduce
// it, so reconciliation on return/exchange is intentionally a no-op.
describe('reconcileCommissionsForSale', () => {
  function mockTx() {
    return {
      commission: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      sale: { findUnique: jest.fn(), findMany: jest.fn() },
    } as any;
  }

  it('does nothing — a return/exchange never touches commission', async () => {
    const tx = mockTx();
    await reconcileCommissionsForSale(tx, 143, 1, 1);
    expect(tx.commission.findMany).not.toHaveBeenCalled();
    expect(tx.commission.deleteMany).not.toHaveBeenCalled();
    expect(tx.commission.create).not.toHaveBeenCalled();
    expect(tx.commission.update).not.toHaveBeenCalled();
    expect(tx.sale.findUnique).not.toHaveBeenCalled();
    expect(tx.sale.findMany).not.toHaveBeenCalled();
  });
});
