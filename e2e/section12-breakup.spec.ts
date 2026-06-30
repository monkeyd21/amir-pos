import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { gotoPos, addItem, payCashExact } from './lib';

/**
 * §12 — Detailed Sales Transaction Breakup. A sale with a manual + special
 * discount must show an itemized bill-breakup (MRP → deductions → GST → total)
 * on the Sales detail page.
 */
test('§12 — Sales detail shows the itemized bill breakup', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  await addItem(page);

  // Manual discount ₹100 + special discount ₹50.
  await page.locator('button[title="Flat rupee amount"]').click();
  const moneyInputs = page.locator('input[appnospin]');
  await moneyInputs.nth(0).fill('100'); // manual discount
  await moneyInputs.nth(1).fill('50'); // special discount

  await payCashExact(page);
  const popup = page.waitForEvent('popup');
  await page.locator('button:has-text("Complete Sale")').click();
  await expect(page.getByText(/Sale completed/i).first()).toBeVisible({ timeout: 10000 });
  const saleNumber = (await page.getByText(/Sale completed/i).first().textContent())?.match(/[WO]-\d+/)?.[0];
  await (await popup).close().catch(() => {});

  // Open the sale and verify the breakup itemizes the deductions.
  await page.goto('/sales');
  await page.getByText(saleNumber!).first().click();
  await expect(page).toHaveURL(/\/sales\//);

  const breakup = page.locator('div', { has: page.getByText('Bill Breakup') }).last();
  await expect(page.getByText('Bill Breakup')).toBeVisible({ timeout: 10000 });
  await expect(breakup.getByText('Manual Discount')).toBeVisible();
  await expect(breakup.getByText('Special Discount')).toBeVisible();
  await expect(breakup.getByText('CGST')).toBeVisible();
  await expect(breakup.getByText('SGST')).toBeVisible();
  await expect(breakup.getByText('Total Paid')).toBeVisible();
  // The special-discount amount (50) is itemized.
  await expect(breakup.getByText(/Special Discount/).locator('xpath=following-sibling::*[1]')).toContainText('50');
});
