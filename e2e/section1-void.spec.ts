import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, BARCODE } from './lib';

/**
 * §1.4 — same-day VOID with a supervisor PIN: restores inventory, marks the bill
 * voided, no return transaction. Wrong PIN is rejected.
 */
test('§1.4 — void a same-day sale requires the supervisor PIN', async ({ page, request }) => {
  const token = await apiLogin(request);
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };

  // A fresh same-day sale.
  const sale = (await (await request.post(`${API}/pos/checkout`, {
    headers: h,
    data: {
      items: [{ barcode: BARCODE, quantity: 1 }],
      payments: [{ method: 'cash', amount: 10000 }],
      channel: 'walkin',
      clientRef: `e2e-void-${Date.now()}`,
    },
  })).json()).data;
  const saleId = sale.sale?.id ?? sale.id;

  await login(page);
  await page.goto(`/sales/${saleId}`);

  // Void button is shown for a same-day completed sale.
  await expect(page.locator('[data-testid="void-button"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="void-button"]').click();
  await expect(page.locator('[data-testid="void-prompt"]')).toBeVisible();

  // Wrong PIN → rejected.
  await page.locator('[data-testid="void-pin"]').fill('0000');
  await page.locator('[data-testid="void-confirm"]').click();
  await expect(page.getByText(/Invalid supervisor PIN/i).first()).toBeVisible({ timeout: 8000 });

  // Correct PIN → voided; the button disappears and status flips.
  await page.locator('[data-testid="void-pin"]').fill('1234');
  await page.locator('[data-testid="void-confirm"]').click();
  await expect(page.getByText(/Sale voided/i).first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-testid="void-button"]')).toHaveCount(0);

  // Backend confirms the void.
  const after = (await (await request.get(`${API}/sales/${saleId}`, { headers: authHeaders(token) })).json()).data;
  expect(after.status).toBe('void');
});
