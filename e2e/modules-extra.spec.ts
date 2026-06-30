import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Coverage for the remaining modules that had no spec before, so the whole
 * system is netted. Asserts stable structure (headings, key controls, columns),
 * not seeded data.
 */

test.describe('Modules — structure', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Offers list', async ({ page }) => {
    await page.goto('/offers');
    await expect(page.locator('h1').filter({ hasText: 'Offers' })).toBeVisible();
    await expect(page.getByText('Manage discounts and promotions applied at POS')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Offer' })).toBeVisible();
  });

  test('Offers — New Offer navigates to the editor', async ({ page }) => {
    await page.goto('/offers');
    await page.getByRole('link', { name: 'New Offer' }).click();
    await expect(page).toHaveURL(/\/offers\/new/);
  });

  test('Vendors list', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.locator('h1').filter({ hasText: 'Vendors' })).toBeVisible();
    await expect(
      page.locator('input[placeholder="Search by name, contact, phone, email or GST..."]')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Vendor' })).toBeVisible();
  });

  test('Vouchers list', async ({ page }) => {
    await page.goto('/vouchers');
    await expect(page.locator('h1').filter({ hasText: 'Gift Vouchers' })).toBeVisible();
    await expect(page.locator('input[placeholder="Search code…"]')).toBeVisible();
  });

  test('Expenses list', async ({ page }) => {
    await page.goto('/expenses');
    await expect(page.locator('h1').filter({ hasText: 'Expenses' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add Expense' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Categories' })).toBeVisible();
  });

  test('Accounting — general ledger', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page).toHaveURL(/\/accounting/);
    await expect(page.getByText('General Ledger').first()).toBeVisible({ timeout: 10000 });
  });

  test('Accounting — P&L statement', async ({ page }) => {
    await page.goto('/accounting/pnl');
    await expect(page.getByText('Profit & Loss Statement').first()).toBeVisible({ timeout: 10000 });
  });

  test('Reports landing', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('h1').filter({ hasText: 'Reports' })).toBeVisible();
    await expect(page.getByText('Sales Report').first()).toBeVisible();
  });

  test('Audit log', async ({ page }) => {
    await page.goto('/audit');
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
