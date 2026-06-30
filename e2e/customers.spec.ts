import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Customers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/customers');
  });

  test('list page renders with heading, search and columns', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: 'Customer Management' })).toBeVisible();
    await expect(
      page.locator('input[placeholder="Search customers by name, email or phone..."]')
    ).toBeVisible();
    for (const col of ['Customer Name', 'Total Spent', 'Loyalty Tier', 'Loyalty Points', 'Visits']) {
      await expect(page.locator(`th:has-text("${col}")`).first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add Customer' })).toBeVisible();
  });

  test('opening a customer shows the detail page (if any exist)', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/customers\/\d+/);
      // Loyalty + KPI labels render on the detail page.
      await expect(page.getByText('Loyalty Points').first()).toBeVisible({ timeout: 10000 });
    }
  });
});
