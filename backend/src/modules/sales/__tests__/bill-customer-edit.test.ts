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
};

const saleWithCustomer = {
  id: 5,
  saleNumber: 'SL-0005',
  status: 'completed',
  customerId: 9,
  customer: existingCustomer,
};

const walkInSale = {
  id: 6,
  saleNumber: 'SL-0006',
  status: 'completed',
  customerId: null,
  customer: null,
};

const put = (saleId: number, body: Record<string, unknown>, user = testUsers.manager) =>
  request(app).put(`${BASE}/${saleId}/customer`).set('Authorization', authHeader(user)).send(body);

describe('PUT /sales/:saleId/customer (bug5)', () => {
  it('corrects the name and phone on the attached customer', async () => {
    prismaMock.sale.findUnique.mockResolvedValue(saleWithCustomer);
    prismaMock.customer.findUnique.mockResolvedValue(null);
    prismaMock.customer.update.mockResolvedValue({
      ...existingCustomer,
      firstName: 'Sabina',
      phone: '9876511111',
    });
    prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

    const res = await put(5, { firstName: 'Sabina', lastName: 'Khan', phone: '9876511111' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.firstName).toBe('Sabina');
    expect(res.body.data.customer.phone).toBe('9876511111');
    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 } })
    );
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
    expect(entry.data.original.firstName).toBe('Sabiha');
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

  it('is not open to cashiers', async () => {
    const res = await put(5, { firstName: 'Sabiha', phone: '9876500000' }, testUsers.cashier);

    expect(res.status).toBe(403);
  });
});
