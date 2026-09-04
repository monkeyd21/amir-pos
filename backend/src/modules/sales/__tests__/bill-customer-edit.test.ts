import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

/**
 * bug5 — limited bill editing.
 *
 * A misheard name or a wrong digit in a phone number used to mean voiding the
 * bill and rebilling it, which churns GST, commission and the day's
 * reconciliation for what is a clerical fix. Only the customer's identity is
 * editable; nothing that touches money is.
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

const BASE = '/api/v1/sales';

const existingCustomer = {
  id: 9,
  firstName: 'Sabiha',
  lastName: 'Khan',
  phone: '9876500000',
  email: 'sabiha@example.com',
  address: '12 Nehru Road',
};

// The financial half of the bill travels on the same row the endpoint loads,
// so the tests can prove none of it is written back.
const saleMoney = {
  subtotal: '2400',
  discountAmount: '150',
  taxAmount: '0',
  total: '2250',
  paymentMethod: 'cash',
  userId: 2,
  businessDate: new Date('2026-08-01T00:00:00.000Z'),
};

const saleWithCustomer = {
  id: 5,
  saleNumber: 'SL-0005',
  status: 'completed',
  customerId: 9,
  customer: existingCustomer,
  ...saleMoney,
};

const walkInSale = {
  id: 6,
  saleNumber: 'SL-0006',
  status: 'completed',
  customerId: null,
  customer: null,
  ...saleMoney,
};

const put = (saleId: number, body: Record<string, unknown>, user = testUsers.manager) =>
  request(app).put(`${BASE}/${saleId}/customer`).set('Authorization', authHeader(user)).send(body);

describe('PUT /sales/:saleId/customer (bug5)', () => {
  it('corrects the name, phone, email and address on the attached customer', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
    prismaMock.customer.findUnique.mockResolvedValue(null);
    prismaMock.customer.update.mockResolvedValue({
      ...existingCustomer,
      firstName: 'Sabina',
      phone: '9876511111',
      email: 'sabina@example.com',
      address: '14 Nehru Road',
    });
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

    const res = await put(5, {
      firstName: 'Sabina',
      lastName: 'Khan',
      phone: '9876511111',
      email: 'sabina@example.com',
      address: '14 Nehru Road',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.firstName).toBe('Sabina');
    expect(res.body.data.customer.phone).toBe('9876511111');
    expect(res.body.data.customer.email).toBe('sabina@example.com');
    expect(res.body.data.customer.address).toBe('14 Nehru Road');
    expect(prismaMock.customer.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        firstName: 'Sabina',
        lastName: 'Khan',
        phone: '9876511111',
        email: 'sabina@example.com',
        address: '14 Nehru Road',
      },
    });
    // The bill itself must not be rewritten when the customer is already attached.
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('writes an audit record with before and after', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
    prismaMock.customer.findUnique.mockResolvedValue(null);
    prismaMock.customer.update.mockResolvedValue({ ...existingCustomer, firstName: 'Sabina' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

    await put(5, { firstName: 'Sabina', phone: '9876500000' });

    const entry = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(entry.action).toBe('sale.customerEdited');
    expect(entry.entityId).toBe('5');
    expect(entry.userId).toBe(testUsers.manager.userId);
    expect(entry.data.saleNumber).toBe('SL-0005');
    expect(entry.data.original.firstName).toBe('Sabiha');
    expect(entry.data.original.phone).toBe('9876500000');
    expect(entry.data.original.email).toBe('sabiha@example.com');
    expect(entry.data.updated.firstName).toBe('Sabina');
  });

  it('attaches a new customer to a walk-in bill', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(walkInSale);
    prismaMock.customer.findUnique.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue({
      id: 12,
      firstName: 'Ayaan',
      lastName: null,
      phone: '9812345678',
      email: null,
      address: null,
    });
    prismaMock.sale.update.mockResolvedValue({ ...walkInSale, customerId: 12 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

    const res = await put(6, { firstName: 'Ayaan', phone: '9812345678' });

    expect(res.status).toBe(200);
    expect(res.body.data.attached).toBe(true);
    expect(prismaMock.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 6 }, data: { customerId: 12 } })
    );
  });

  it('refuses a phone that already belongs to a different customer', async () => {
    // That is a merge of two real people's history, not a typo fix.
    prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
    prismaMock.customer.findUnique.mockResolvedValue({
      id: 44,
      firstName: 'Someone',
      lastName: 'Else',
      phone: '9800000000',
    });

    const res = await put(5, { firstName: 'Sabiha', phone: '9800000000' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already belongs to another customer/i);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a voided bill', async () => {
    prismaMock.sale.findUnique.mockResolvedValue({ ...saleWithCustomer, status: 'void' });

    const res = await put(5, { firstName: 'Sabiha', phone: '9876500000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/void/i);
  });

  it('404s on an unknown bill', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(null);

    const res = await put(999, { firstName: 'Sabiha', phone: '9876500000' });

    expect(res.status).toBe(404);
  });

  it('rejects an empty name and a malformed phone', async () => {
    expect((await put(5, { firstName: '', phone: '9876500000' })).status).toBe(400);
    expect((await put(5, { firstName: 'Sabiha', phone: 'not-a-phone' })).status).toBe(400);
  });

  it('rejects a phone the customer create form would reject', async () => {
    // Both screens write the same Customer row, so the bill must not be the
    // laxer door: a 6-digit stub and a letters-only string both fail here
    // exactly as they do at /customers/new.
    expect((await put(5, { firstName: 'Sabiha', phone: '98765' })).status).toBe(400);
    expect((await put(5, { firstName: 'Sabiha', phone: '123456' })).status).toBe(400);
    expect((await put(5, { firstName: 'Sabiha', phone: 'abcdefghij' })).status).toBe(400);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const res = await put(5, {
      firstName: 'Sabiha',
      phone: '9876500000',
      email: 'sabiha@',
    });

    expect(res.status).toBe(400);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('is not open to cashiers', async () => {
    // Note the open question in routes.ts: a cashier refused here may still
    // edit the same Customer row through the ungated customers route. Which
    // way the two are made to agree is the owner's call, so this route keeps
    // the gate it shipped with.
    const res = await put(5, { firstName: 'Sabiha', phone: '9876500000' }, testUsers.cashier);

    expect(res.status).toBe(403);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  describe("the bill's money is out of reach", () => {
    it('writes nothing financial, even when the request tries to smuggle it in', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.update.mockResolvedValue(existingCustomer);
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const res = await put(5, {
        firstName: 'Sabina',
        phone: '9876500000',
        // None of these are part of the endpoint's contract.
        total: 1,
        subtotal: 1,
        discountAmount: 999,
        taxAmount: 0,
        paymentMethod: 'card',
        businessDate: '2020-01-01',
        userId: 99,
        status: 'void',
        items: [{ id: 1, quantity: 50, unitPrice: 0 }],
      });

      expect(res.status).toBe(200);
      // No write to the sale at all, so no financial column can have moved.
      expect(prismaMock.sale.update).not.toHaveBeenCalled();
      // And the customer write carries contact keys only.
      const written = prismaMock.customer.update.mock.calls[0][0].data;
      expect(Object.keys(written).sort()).toEqual([
        'address',
        'email',
        'firstName',
        'lastName',
        'phone',
      ]);
    });

    it('touches only customerId when attaching a walk-in, never an amount', async () => {
      prismaMock.sale.findUnique.mockResolvedValue(walkInSale);
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 12,
        firstName: 'Ayaan',
        lastName: null,
        phone: '9812345678',
        email: null,
        address: null,
      });
      prismaMock.sale.update.mockResolvedValue({ ...walkInSale, customerId: 12 });
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      await put(6, { firstName: 'Ayaan', phone: '9812345678', total: 1, discountAmount: 500 });

      const written = prismaMock.sale.update.mock.calls[0][0].data;
      expect(Object.keys(written)).toEqual(['customerId']);
    });

    it('never re-points a bill that already has a customer', async () => {
      // Re-linking a bill to a different person is a separate decision and is
      // deliberately not built: the phone of another customer is refused.
      prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
      prismaMock.customer.findUnique.mockResolvedValue({
        id: 44,
        firstName: 'Someone',
        lastName: 'Else',
        phone: '9800000000',
        email: null,
        address: null,
      });

      const res = await put(5, { firstName: 'Sabiha', phone: '9800000000' });

      expect(res.status).toBe(409);
      expect(prismaMock.sale.update).not.toHaveBeenCalled();
    });
  });
});
