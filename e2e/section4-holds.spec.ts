import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders } from './lib';

/**
 * §4 — Hold Bill rules (beyond remarks, which are covered in built-section1-7 §4).
 *   §4.3 held items are soft-reserved (catalog shows reserved + available)
 *   §4.4 holds carry a ~24h expiry
 *   §4.5 EOD (daily-summary) lists active holds with cashier, remarks, age
 */

function reservedFor(catalog: any, variantId: number) {
  const v = catalog.data.items.find((i: any) => i.variantId === variantId);
  return { stock: v.stock, reserved: v.reserved, available: v.available };
}

test('§4.3/4.4/4.5 — hold reserves stock, expires in ~24h, and shows in the EOD report', async ({ request }) => {
  const token = await apiLogin(request);
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };

  const before = reservedFor(await (await request.get(`${API}/pos/catalog`, { headers: authHeaders(token) })).json(), 1);

  const remark = `e2e hold ${Date.now()}`;
  const held = (await (await request.post(`${API}/pos/hold`, {
    headers: h,
    data: { cartData: { cart: [{ variantId: 1, quantity: 2 }] }, notes: remark },
  })).json()).data;

  // §4.4 — expiry ~24h ahead.
  const hours = (new Date(held.expiresAt).getTime() - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23);
  expect(hours).toBeLessThan(25);

  // §4.3 — catalog reserved grew by 2; available = stock − reserved.
  const after = reservedFor(await (await request.get(`${API}/pos/catalog`, { headers: authHeaders(token) })).json(), 1);
  expect(after.reserved).toBe(before.reserved + 2);
  expect(after.available).toBe(after.stock - after.reserved);

  // §4.5 — the hold appears in the EOD report with cashier, remarks, age.
  const summary = (await (await request.get(`${API}/reports/daily-summary`, { headers: authHeaders(token) })).json()).data;
  const mine = summary.activeHolds.find((x: any) => x.remarks === remark);
  expect(mine).toBeTruthy();
  expect(mine.cashier).toBeTruthy();
  expect(mine.ageMinutes).toBeGreaterThanOrEqual(0);
});
