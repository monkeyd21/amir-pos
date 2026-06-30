import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, BARCODE } from './lib';

/**
 * §3 — Seamless Bill Editing.
 *   §3.1 bill editing reachable from the POS (no Sales-tab hunt)
 *   §3.4 edit lock by payment status: fully-paid bills are blocked (return/exchange)
 *        (unpaid/partial transitions are unit-tested in helpers.test.ts)
 */

test('§3.1 — POS previous-bills panel can open the bill editor', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await page.locator('button[title="Previous bills"]').click();
  const editBtn = page.locator('[data-testid="pos-edit-bill"]').first();
  await expect(editBtn).toBeVisible({ timeout: 10000 });
  await editBtn.click();
  await expect(page).toHaveURL(/\/sales\/\d+\/edit/);
});

test('§3.4 — editing a fully-paid bill is blocked', async ({ request }) => {
  const token = await apiLogin(request);
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };

  const sale = (await (await request.post(`${API}/pos/checkout`, {
    headers: h,
    data: {
      items: [{ barcode: BARCODE, quantity: 1 }],
      payments: [{ method: 'cash', amount: 10000 }],
      channel: 'walkin',
      clientRef: `e2e-edit-${Date.now()}`,
    },
  })).json()).data;
  const saleId = sale.sale?.id ?? sale.id;
  const detail = (await (await request.get(`${API}/sales/${saleId}`, { headers: authHeaders(token) })).json()).data;
  const itemId = detail.items[0].id;

  // Fully paid → edit rejected with a clear message.
  const res = await request.put(`${API}/sales/${saleId}/edit`, {
    headers: h,
    data: { items: [{ saleItemId: itemId, quantity: 1 }], reason: 'try edit' },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/fully paid/i);
});
