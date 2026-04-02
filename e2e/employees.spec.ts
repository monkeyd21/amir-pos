import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Employees', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to employees page', async ({ page }) => {
    await page.goto('/employees');

    await expect(page.locator('h1:has-text("Employees")')).toBeVisible();
    await expect(page.locator('text=Manage staff and roles')).toBeVisible();
  });

  test('should load the employee list with table columns', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });

    // Table header columns
    await expect(page.locator('th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("Role")')).toBeVisible();
    await expect(page.locator('th:has-text("Branch")')).toBeVisible();
    await expect(page.locator('th:has-text("Commission %")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();

    // Paginator
    await expect(page.locator('mat-paginator')).toBeVisible();
  });

  test('should have a search field', async ({ page }) => {
    await page.goto('/employees');

    await expect(page.locator('input[placeholder="Name, role..."]')).toBeVisible();
  });

  test('should have Add Employee button', async ({ page }) => {
    await page.goto('/employees');

    await expect(page.locator('button:has-text("Add Employee")')).toBeVisible();
  });

  test('should navigate to attendance page', async ({ page }) => {
    await page.goto('/employees/attendance');

    await expect(page).toHaveURL(/\/employees\/attendance/);
    await expect(page.locator('app-attendance, [class*="attendance"]')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to commissions page', async ({ page }) => {
    await page.goto('/employees/commissions');

    await expect(page).toHaveURL(/\/employees\/commissions/);
    await expect(page.locator('app-commissions, [class*="commission"]')).toBeVisible({ timeout: 10000 });
  });
});
