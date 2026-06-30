import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('loads with heading', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1').filter({ hasText: 'Dashboard' })).toBeVisible();
  });

  test('shows the KPI cards', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText("Today's Sales")).toBeVisible();
    await expect(main.getByText('Revenue', { exact: true })).toBeVisible();
    await expect(main.getByText('Customers', { exact: true })).toBeVisible();
    await expect(main.getByText('Low Stock', { exact: true })).toBeVisible();
  });

  test('shows the analytics sections', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('Weekly Sales')).toBeVisible();
    await expect(main.getByText('Stock Alerts')).toBeVisible();
    await expect(main.getByText('Recent Sales')).toBeVisible();
  });

  test('sidebar links navigate between modules', async ({ page }) => {
    // Navigate between main-layout routes (POS is full-screen with no sidebar,
    // so it's covered separately in journeys/changes-new).
    const nav = page.locator('app-sidebar');
    await nav.locator('a[href="/sales"]').click();
    await expect(page).toHaveURL(/\/sales/);
    await nav.locator('a[href="/customers"]').click();
    await expect(page).toHaveURL(/\/customers/);
    await nav.locator('a[href="/inventory"]').click();
    await expect(page).toHaveURL(/\/inventory/);
  });
});
