import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('products list renders with heading, search and columns', async ({ page }) => {
    await page.goto('/inventory/products');
    await expect(page.locator('h1').filter({ hasText: 'Products' })).toBeVisible();
    await expect(page.locator('input[placeholder="Search products..."]')).toBeVisible();
    for (const col of ['SKU', 'Brand', 'Category', 'Price']) {
      await expect(page.locator(`th:has-text("${col}")`).first()).toBeVisible();
    }
  });

  test('Add Product navigates to the create page', async ({ page }) => {
    await page.goto('/inventory/products');
    await page
      .locator('a:has-text("Add Product"), button:has-text("Add Product")')
      .first()
      .click();
    await expect(page).toHaveURL(/\/inventory\/products\/new/);
  });

  test('stock levels page loads', async ({ page }) => {
    await page.goto('/inventory/stock');
    await expect(page.locator('h1').filter({ hasText: 'Inventory Levels' })).toBeVisible({ timeout: 10000 });
  });

  test('transfers page loads', async ({ page }) => {
    await page.goto('/inventory/transfers');
    await expect(page.locator('h1').filter({ hasText: 'Stock Transfers' })).toBeVisible({ timeout: 10000 });
  });

  test('import page loads', async ({ page }) => {
    await page.goto('/inventory/import');
    await expect(page.locator('h1').filter({ hasText: 'Import Inventory' })).toBeVisible({ timeout: 10000 });
  });
});
