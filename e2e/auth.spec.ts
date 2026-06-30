import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Auth', () => {
  test('renders the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[formcontrolname="email"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[formcontrolname="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('valid credentials redirect to the dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1').filter({ hasText: 'Dashboard' })).toBeVisible();
  });

  test('invalid credentials show an error and stay on login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[formcontrolname="email"]', 'admin@clothingerp.com');
    await page.fill('input[formcontrolname="password"]', 'wrong-password');
    await page.click('button[type="submit"]');
    await expect(page.locator('[class*="bg-error"]')).toBeVisible({ timeout: 10000 });
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test('logout returns to the login page', async ({ page }) => {
    await login(page);
    await page.locator('header button').last().click();
    await page.getByText('Sign out').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('protected routes redirect to login when unauthenticated', async ({ page }) => {
    for (const route of ['/dashboard', '/pos', '/sales']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    }
  });
});
