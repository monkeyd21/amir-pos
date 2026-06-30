import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Sales', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/sales');
  });

  test('list page renders with heading and columns', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: 'Sales Management' })).toBeVisible();
    await expect(page.getByText('Track and manage all sales transactions')).toBeVisible();
    for (const col of ['Sale #', 'Customer', 'Items', 'Total', 'Payment', 'Status', 'Date']) {
      await expect(page.locator(`th:has-text("${col}")`).first()).toBeVisible();
    }
  });

  test('filter controls toggle open', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  test('opening a sale shows the detail page (if any sales exist)', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/sales\/[A-Za-z0-9-]+/);
      await expect(page.locator('h1').filter({ hasText: 'Sale' })).toBeVisible({ timeout: 10000 });
      // Return entry point should exist on a completed sale.
      const returnBtn = page.getByRole('button', { name: /Process Return/i });
      if (await returnBtn.count()) {
        await returnBtn.first().click();
        await expect(page.getByText('Process Return').first()).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
