import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Sales', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to sales page', async ({ page }) => {
    await page.goto('/sales');

    await expect(page.locator('h1:has-text("Sales")')).toBeVisible();
    await expect(page.locator('text=View and manage sales transactions')).toBeVisible();
  });

  test('should load the sales list with table columns', async ({ page }) => {
    await page.goto('/sales');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Table header columns
    await expect(page.locator('th:has-text("Sale #")')).toBeVisible();
    await expect(page.locator('th:has-text("Date")')).toBeVisible();
    await expect(page.locator('th:has-text("Customer")')).toBeVisible();
    await expect(page.locator('th:has-text("Total")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();

    // Paginator
    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should have filter controls', async ({ page }) => {
    await page.goto('/sales');

    await expect(page.locator('mat-label:has-text("Date From")')).toBeVisible();
    await expect(page.locator('mat-label:has-text("Date To")')).toBeVisible();
    await expect(page.locator('mat-label:has-text("Status")')).toBeVisible();
    await expect(page.locator('mat-label:has-text("Branch")')).toBeVisible();
    await expect(page.locator('button:has-text("Apply")')).toBeVisible();
    await expect(page.locator('button:has-text("Clear")')).toBeVisible();
  });

  test('should navigate to sale detail when clicking View button', async ({ page }) => {
    await page.goto('/sales');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Click the first View button if data rows exist
    const viewButton = page.locator('button:has-text("View")').first();
    if (await viewButton.isVisible()) {
      await viewButton.click();
      await expect(page).toHaveURL(/\/sales\/\d+/);
      // Sale detail page should show sale info
      await expect(page.locator('text=Sale Number')).toBeVisible({ timeout: 10000 });
    }
  });

  test('should show return dialog on sale detail page', async ({ page }) => {
    await page.goto('/sales');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    const viewButton = page.locator('button:has-text("View")').first();
    if (await viewButton.isVisible()) {
      await viewButton.click();
      await expect(page).toHaveURL(/\/sales\/\d+/);

      // Wait for detail page to load
      await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 10000 });

      const returnButton = page.locator('button:has-text("Process Return")');
      if (await returnButton.isVisible()) {
        await returnButton.click();
        await expect(page.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
