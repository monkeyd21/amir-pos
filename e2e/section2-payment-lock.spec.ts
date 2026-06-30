import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { gotoPos, addItem } from './lib';

/**
 * §2.5 — the payment tender panel is locked until the cashier confirms
 * discounts are applied (mandatory mobile → discounts → payment sequence).
 */
test('§2.5 — payment is locked until "Proceed to Payment"', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await addItem(page);

  // Locked: the gate button shows; tender controls (Exact) are hidden.
  await expect(page.locator('[data-testid="proceed-to-payment"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exact' })).toHaveCount(0);

  // Unlock → tender controls appear.
  await page.locator('[data-testid="proceed-to-payment"]').click();
  await expect(page.getByRole('button', { name: 'Exact' })).toBeVisible();
});
