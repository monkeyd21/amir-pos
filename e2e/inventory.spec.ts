import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to products page and display the product list', async ({ page }) => {
    await page.goto('/inventory/products');

    await expect(page.locator('h1:has-text("Products")')).toBeVisible();
    await expect(page.locator('text=Manage your product catalog')).toBeVisible();
  });

  test('should load product list with table data', async ({ page }) => {
    await page.goto('/inventory/products');

    // Wait for the table to load (spinner disappears and table rows appear)
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Table should be visible with header columns
    await expect(page.locator('th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("SKU")')).toBeVisible();
    await expect(page.locator('th:has-text("Brand")')).toBeVisible();
    await expect(page.locator('th:has-text("Category")')).toBeVisible();
    await expect(page.locator('th:has-text("Price")')).toBeVisible();

    // Paginator should be visible
    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should open add product dialog', async ({ page }) => {
    await page.goto('/inventory/products');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    await page.locator('button:has-text("Add Product")').click();

    // Dialog should appear
    await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to stock levels page', async ({ page }) => {
    await page.goto('/inventory/stock');

    await expect(page.locator('h1').filter({ hasText: 'Stock' })).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to transfers page', async ({ page }) => {
    await page.goto('/inventory/transfers');

    // The transfers page or placeholder should be visible
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/transfers/);
  });

  test('should have search and filter controls on products page', async ({ page }) => {
    await page.goto('/inventory/products');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Search field
    await expect(page.locator('input[placeholder="Name, SKU..."]')).toBeVisible();

    // Brand filter
    await expect(page.locator('mat-label:has-text("Brand")')).toBeVisible();

    // Category filter
    await expect(page.locator('mat-label:has-text("Category")')).toBeVisible();

    // Clear button
    await expect(page.locator('button:has-text("Clear")')).toBeVisible();
  });
});
