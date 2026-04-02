import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Customers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to customers page', async ({ page }) => {
    await page.goto('/customers');

    await expect(page.locator('h1:has-text("Customers")')).toBeVisible();
    await expect(page.locator('text=Manage customer profiles and loyalty')).toBeVisible();
  });

  test('should load the customer list with table columns', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Table header columns
    await expect(page.locator('th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("Phone")')).toBeVisible();
    await expect(page.locator('th:has-text("Email")')).toBeVisible();
    await expect(page.locator('th:has-text("Tier")')).toBeVisible();
    await expect(page.locator('th:has-text("Points")')).toBeVisible();
    await expect(page.locator('th:has-text("Total Spent")')).toBeVisible();

    // Paginator
    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should have a search field', async ({ page }) => {
    await page.goto('/customers');

    await expect(page.locator('input[placeholder="Search..."]')).toBeVisible();
  });

  test('should open add customer dialog', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    await page.locator('button:has-text("Add Customer")').click();

    // Dialog should appear
    await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to customer detail page when clicking a row', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Click the first data row in the table
    const firstRow = page.locator('table tbody tr, mat-table mat-row').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/customers\/\d+/);

      // Customer detail page should show profile and loyalty info
      await expect(page.locator('text=Customer Profile')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Loyalty Card')).toBeVisible();
    }
  });
});
