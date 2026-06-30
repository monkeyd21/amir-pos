import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, addItem, payCashExact, BARCODE } from './lib';

/**
 * UI verification for built items in sections 6 (gift vouchers) and 11 (offline).
 *   §6.1a/§6.1b voucher manual issuance + system code
 *   §6.2a partial redemption keeps a remaining balance
 *   §6.2d expiry/balance validated before applying
 *   §11.1 billing offline (queued)   §11.2 barcode scan offline (local catalog)
 */

async function createVoucher(
  request: any,
  token: string,
  value: number,
  extra: Record<string, unknown> = {}
) {
  const res = await request.post(`${API}/vouchers`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { value, ...extra },
  });
  expect(res.ok(), `voucher create: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

test.describe('§6.1 — voucher issuance', () => {
  test('a manager can issue a voucher and it gets a system GV- code', async ({ page }) => {
    await login(page);
    await page.goto('/vouchers');
    await expect(page.locator('h1').filter({ hasText: 'Gift Vouchers' })).toBeVisible();
    await page.locator('input[type="number"]').first().fill('250');
    await page.getByRole('button', { name: 'Create' }).click();
    // A new card with a system-generated GV- code appears.
    await expect(page.getByText(/GV-[0-9A-F]{8}/).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('§6.2a — partial redemption keeps a balance', () => {
  test('a high-value voucher applied to a smaller bill retains the remainder', async ({ page, request }) => {
    const token = await apiLogin(request);
    const voucher = await createVoucher(request, token, 50000); // far exceeds one item

    await login(page);
    await gotoPos(page);
    await addItem(page);
    await page.locator('input[placeholder="Gift voucher code"]').fill(voucher.code);
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('text=' + voucher.code)).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=Fully Paid')).toBeVisible(); // voucher covers the bill

    const popup = page.waitForEvent('popup');
    await page.locator('button:has-text("Complete Sale")').click();
    await expect(page.getByText(/Sale completed/i).first()).toBeVisible({ timeout: 10000 });
    await (await popup).close().catch(() => {});

    // Remaining balance stayed on the same code and it's still active.
    const res = await request.get(`${API}/vouchers/lookup/${voucher.code}`, { headers: authHeaders(token) });
    const v = (await res.json()).data;
    expect(Number(v.balance)).toBeGreaterThan(0);
    expect(Number(v.balance)).toBeLessThan(50000);
    expect(v.redeemable).toBe(true);
  });
});

test.describe('§6.2d — expiry validated before applying', () => {
  test('an expired voucher is rejected at the POS', async ({ page, request }) => {
    const token = await apiLogin(request);
    const expired = await createVoucher(request, token, 500, { expiresAt: '2020-01-01' });

    await login(page);
    await gotoPos(page);
    await addItem(page);
    await page.locator('input[placeholder="Gift voucher code"]').fill(expired.code);
    await page.locator('button:has-text("Apply")').click();
    await expect(page.getByText(/expired/i).first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('§11 — offline billing', () => {
  test('scan + checkout work offline and queue for sync', async ({ page, context }) => {
    await login(page);
    // Load POS online so the catalog caches locally, then drop the network.
    const catalogSynced = page.waitForResponse('**/pos/catalog**').catch(() => null);
    await gotoPos(page);
    await catalogSynced;

    await context.setOffline(true);
    try {
      // §11.2 — barcode resolves from the local catalog while offline.
      await addItem(page, BARCODE);
      // §11.1 — checkout completes offline and is queued with a temp number.
      await payCashExact(page);
      await page.locator('button:has-text("Complete Sale")').click();
      await expect(page.getByText(/Saved offline/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await context.setOffline(false);
    }
  });
});
