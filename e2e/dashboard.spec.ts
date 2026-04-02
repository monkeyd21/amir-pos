import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should load the dashboard page', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Welcome back')).toBeVisible();
  });

  test('should display KPI cards for sales, revenue, customers, and low stock', async ({ page }) => {
    await expect(page.locator("text=Today's Sales")).toBeVisible();
    await expect(page.locator("text=Today's Revenue")).toBeVisible();
    await expect(page.locator('text=Total Customers')).toBeVisible();
    await expect(page.locator('text=Low Stock Items')).toBeVisible();
  });

  test('should display Sales Overview chart section', async ({ page }) => {
    await expect(page.locator('text=Sales Overview')).toBeVisible();
    // Period buttons: 7D, 30D, 90D
    await expect(page.locator('button:has-text("7D")')).toBeVisible();
    await expect(page.locator('button:has-text("30D")')).toBeVisible();
    await expect(page.locator('button:has-text("90D")')).toBeVisible();
  });

  test('should display Top Products section', async ({ page }) => {
    await expect(page.locator('text=Top Products')).toBeVisible();
    await expect(page.locator('text=Cotton Formal Shirt')).toBeVisible();
  });

  test('should display Recent Sales table', async ({ page }) => {
    await expect(page.locator('text=Recent Sales')).toBeVisible();
    await expect(page.locator('text=INV-001')).toBeVisible();
  });

  test('should display Low Stock Alerts section', async ({ page }) => {
    await expect(page.locator('text=Low Stock Alerts')).toBeVisible();
    await expect(page.locator('text=White Formal Shirt (M)')).toBeVisible();
  });

  test('should navigate to each module via the sidebar', async ({ page }) => {
    // Dashboard (already on it)
    await expect(page.locator('app-sidebar a[href="/dashboard"]')).toBeVisible();

    // POS
    await page.locator('app-sidebar a[href="/pos"]').click();
    await expect(page).toHaveURL(/\/pos/);

    // Navigate back to dashboard to test other links
    await page.goto('/dashboard');

    // Sales
    await page.locator('app-sidebar a[href="/sales"]').click();
    await expect(page).toHaveURL(/\/sales/);

    await page.goto('/dashboard');

    // Customers
    await page.locator('app-sidebar a[href="/customers"]').click();
    await expect(page).toHaveURL(/\/customers/);

    await page.goto('/dashboard');

    // Employees
    await page.locator('app-sidebar a[href="/employees"]').click();
    await expect(page).toHaveURL(/\/employees/);

    await page.goto('/dashboard');

    // Inventory (has children, must expand)
    await page.locator('app-sidebar button:has-text("Inventory")').click();
    await page.locator('app-sidebar a[href="/inventory/products"]').click();
    await expect(page).toHaveURL(/\/inventory\/products/);

    await page.goto('/dashboard');

    // Settings
    await page.locator('app-sidebar a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
