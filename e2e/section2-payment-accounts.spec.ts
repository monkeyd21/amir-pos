import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, addItem, proceedToPayment } from './lib';

/**
 * §2.1/2.2/2.4 — Card/UPI payment accounts.
 *   §2.1 Settings: separate Card & UPI account lists + default
 *   §2.2 default account auto-populates at billing
 *   §2.4 cashier can override and pick another account per bill
 */

test.beforeAll(async ({ request }) => {
  const token = await apiLogin(request);
  await request.put(`${API}/settings/payment-accounts`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { card: [{ name: 'HDFC', isDefault: true }, { name: 'ICICI', isDefault: false }], upi: [{ name: 'PhonePe', isDefault: true }] },
  });
});

test('§2.1 — Settings Payments tab manages Card/UPI accounts (single default)', async ({ request }) => {
  // The store normalizes to at most one default per mode.
  const token = await apiLogin(request);
  const res = await request.put(`${API}/settings/payment-accounts`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { card: [{ name: 'A', isDefault: true }, { name: 'B', isDefault: true }], upi: [] },
  });
  const data = (await res.json()).data;
  expect(data.card.filter((a: any) => a.isDefault)).toHaveLength(1);

  // restore the fixture accounts
  await request.put(`${API}/settings/payment-accounts`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { card: [{ name: 'HDFC', isDefault: true }, { name: 'ICICI', isDefault: false }], upi: [{ name: 'PhonePe', isDefault: true }] },
  });
});

test('§2.1 — Settings UI: add a card account', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Payments' }).click();
  await expect(page.locator('[data-testid="payments-tab"]')).toBeVisible();
  await page.locator('[data-testid="card-account-input"]').fill('AxisBankE2E');
  await page.locator('[data-testid="card-account-add"]').click();
  await expect(page.locator('[data-testid="payments-tab"]').getByText('AxisBankE2E')).toBeVisible({ timeout: 8000 });
});

test('§2.2/2.4 — POS auto-populates the default account and allows override', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await addItem(page);
  await proceedToPayment(page);
  await page.locator('button:has-text("Card")').first().click();

  const select = page.locator('[data-testid="payment-account-select"]');
  await expect(select).toBeVisible();
  // §2.2 — the default (HDFC) is pre-selected.
  await expect(select).toHaveValue('HDFC');
  // §2.4 — override to another configured account.
  await select.selectOption('ICICI');
  await expect(select).toHaveValue('ICICI');
});
