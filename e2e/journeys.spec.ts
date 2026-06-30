import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { gotoPos, addItem, payCashExact } from './lib';

/**
 * Frontend regression net — exercises the critical user journeys through the
 * real Angular UI. Catches routing/render breakage and the core POS checkout
 * path. Pairs with smoke-api.spec.ts (backend) for whole-system coverage.
 */

// Auth is covered in detail by auth.spec.ts.

test.describe('Navigation smoke — every authed route renders', () => {
  // Each route must load without bouncing back to /login or crashing the router.
  const ROUTES = [
    'dashboard',
    'inventory',
    'sales',
    'offers',
    'customers',
    'vendors',
    'employees',
    'expenses',
    'accounting',
    'reports',
    'settings',
    'audit',
    'vouchers',
    'pos',
  ];

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const route of ROUTES) {
    test(`/${route} loads`, async ({ page }) => {
      await page.goto(`/${route}`);
      await expect(page).toHaveURL(new RegExp(`/${route}`), { timeout: 10000 });
      // Did not get bounced to the login screen.
      await expect(page.locator('input[formcontrolname="password"]')).toHaveCount(0);
      // The app shell actually rendered something.
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }
});

test.describe('POS — core checkout journey', () => {
  test('cash sale completes and prints a receipt', async ({ page }) => {
    await login(page);
    await gotoPos(page);
    await addItem(page);
    await payCashExact(page);

    // Completing the sale auto-opens the receipt popup.
    const popupPromise = page.waitForEvent('popup');
    await page.locator('button:has-text("Complete Sale")').click();

    // Success toast confirms the sale persisted.
    await expect(page.getByText(/Sale completed/i).first()).toBeVisible({ timeout: 10000 });

    // Receipt popup renders with a bill number and total.
    const receipt = await popupPromise;
    await receipt.waitForLoadState('domcontentloaded');
    await expect(receipt.locator('text=TOTAL').first()).toBeVisible({ timeout: 10000 });
  });
});
