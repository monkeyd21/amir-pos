import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Employees', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/employees');
  });

  test('list page renders with heading, search and columns', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: 'Employees' })).toBeVisible();
    await expect(page.locator('input[placeholder="Search employees..."]')).toBeVisible();
    for (const col of ['Name', 'Role', 'Branch', 'Status']) {
      await expect(page.locator(`th:has-text("${col}")`).first()).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Add Employee' })).toBeVisible();
  });

  test('attendance page loads', async ({ page }) => {
    await page.goto('/employees/attendance');
    await expect(page).toHaveURL(/\/employees\/attendance/);
    await expect(page.locator('h1').filter({ hasText: 'Attendance' })).toBeVisible({ timeout: 10000 });
  });

  test('commissions page loads', async ({ page }) => {
    await page.goto('/employees/commissions');
    await expect(page).toHaveURL(/\/employees\/commissions/);
    await expect(page.locator('h1').filter({ hasText: 'Commissions' })).toBeVisible({ timeout: 10000 });
  });
});
