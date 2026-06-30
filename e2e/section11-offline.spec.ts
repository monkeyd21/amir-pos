import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, addItem, payCashExact } from './lib';

/**
 * §11 — Offline behaviour (beyond 11.1/11.2 already covered).
 *   §11.3 customer lookup is read-only offline (from the last synced data)
 *   §11.5 offline bills show as "pending sync" in the Sales tab
 *   §11.6 a bill that fails to sync is flagged as a conflict for manager review
 */

const CUST_SEARCH = 'input[placeholder="Search customer by name, phone..."]';

test('§11.3 — customer lookup works offline from cached data', async ({ page, context, request }) => {
  const token = await apiLogin(request);
  const name = `OfflineCust${Date.now() % 100000}`;
  const phone = '9' + String(Date.now()).slice(-9);
  await request.post(`${API}/customers`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { firstName: name, phone },
  });

  await login(page);
  // Load POS online so customers cache locally.
  const synced = page.waitForResponse('**/customers**').catch(() => null);
  await gotoPos(page);
  await synced;

  await context.setOffline(true);
  try {
    await page.locator(CUST_SEARCH).fill(name);
    await expect(page.locator(`button:has-text("${name}")`).first()).toBeVisible({ timeout: 8000 });
  } finally {
    await context.setOffline(false);
  }
});

test('§11.5 — offline bills appear as pending sync in the Sales tab', async ({ page }) => {
  // Seed a queued offline bill (a real offline checkout produces the same shape).
  const temp = `OFF-${Date.now() % 1000000}`;
  await page.goto('/login');
  await page.evaluate((t) => {
    localStorage.setItem(
      'pos_offline_queue_v1',
      JSON.stringify([{ clientRef: 'e2e-pending-' + Date.now(), tempNumber: t, createdAt: new Date().toISOString(), total: 555, payload: {} }])
    );
  }, temp);

  await login(page);
  await page.goto('/sales'); // online; the Sales tab reads the local queue (no auto-sync here)
  await expect(page.locator('[data-testid="pending-sync"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="pending-sync"]').getByText(temp)).toBeVisible();

  await page.evaluate(() => localStorage.removeItem('pos_offline_queue_v1'));
});

test('§11.6 — a bill that fails to sync is flagged as a conflict', async ({ page }) => {
  // Seed a queued bill that will be rejected on replay (invalid barcode).
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem(
      'pos_offline_queue_v1',
      JSON.stringify([
        {
          clientRef: 'e2e-conflict-' + Date.now(),
          tempNumber: 'OFF-CONFLICT',
          createdAt: new Date().toISOString(),
          total: 100,
          payload: {
            items: [{ barcode: 'NOPE-INVALID-BARCODE', quantity: 1 }],
            payments: [{ method: 'cash', amount: 100 }],
            channel: 'walkin',
          },
        },
      ])
    );
  });

  // Logging in + opening POS (online) triggers a sync attempt → conflict flag.
  await login(page);
  await gotoPos(page);
  // Give the sync a moment, then the Sales tab shows it for review.
  await page.waitForTimeout(2000);
  await page.goto('/sales');
  await expect(page.locator('[data-testid="pending-sync"]').getByText(/Conflict/i).first()).toBeVisible({ timeout: 10000 });

  // cleanup the injected queue
  await page.evaluate(() => localStorage.removeItem('pos_offline_queue_v1'));
});
