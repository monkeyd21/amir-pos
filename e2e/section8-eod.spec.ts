import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { apiLogin, ensureSession, gotoPos } from './lib';

/**
 * §8 — End-of-Day Cash Reconciliation.
 *   §8.1/8.3 EOD panel: expected cash, petty cash, cash drop, physical count,
 *            net variance = Expected − Petty − Drop − Physical.
 *   §8.4 shortfall: variance > ₹50 blocks close until manager PIN + reason.
 *
 * These tests CLOSE the POS session, so each ensures one is open first and the
 * suite re-opens one at the end (checkout tests elsewhere need it).
 */

test.beforeEach(async ({ request }) => {
  const token = await apiLogin(request);
  await ensureSession(request, token);
});

test.afterAll(async ({ request }) => {
  const token = await apiLogin(request);
  await ensureSession(request, token);
});

test('§8.1/8.3 — reconcile drawer; net variance computes and a matched count closes the shift', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await page.locator('[data-testid="eod-button"]').click();
  await expect(page.locator('[data-testid="eod-panel"]')).toBeVisible();

  // Read system-expected, set petty + drop, and count physical so variance = 0.
  const expectedText = (await page.locator('[data-testid="eod-expected"]').textContent()) || '';
  const expected = Number(expectedText.replace(/[^0-9.-]/g, ''));
  await page.locator('[data-testid="eod-petty"]').fill('100');
  await page.locator('[data-testid="eod-drop"]').fill('200');
  await page.locator('[data-testid="eod-physical"]').fill(String(expected - 300)); // variance → 0
  await expect(page.locator('[data-testid="eod-variance"]')).toContainText('0');

  await page.locator('[data-testid="eod-submit"]').click();
  await expect(page.getByText(/Shift closed/i).first()).toBeVisible({ timeout: 8000 });
});

test('§8.4 — a variance over ₹50 is blocked until manager PIN + reason', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await page.locator('[data-testid="eod-button"]').click();
  await expect(page.locator('[data-testid="eod-panel"]')).toBeVisible();

  // Count far short → large variance → shortfall block appears.
  await page.locator('[data-testid="eod-physical"]').fill('0');
  await expect(page.locator('[data-testid="eod-shortfall"]')).toBeVisible();

  // Wrong PIN → rejected.
  await page.locator('[data-testid="eod-pin"]').fill('0000');
  await page.locator('[data-testid="eod-reason"]').fill('till short');
  await page.locator('[data-testid="eod-submit"]').click();
  await expect(page.getByText(/Invalid supervisor PIN/i).first()).toBeVisible({ timeout: 8000 });

  // Correct PIN + reason → closes.
  await page.locator('[data-testid="eod-pin"]').fill('1234');
  await page.locator('[data-testid="eod-submit"]').click();
  await expect(page.getByText(/Shift closed/i).first()).toBeVisible({ timeout: 8000 });
});
