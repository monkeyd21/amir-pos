import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Auth', () => {
  test('should render the login form with email and password fields', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('input[formcontrolname="email"]')).toBeVisible();
    await expect(page.locator('input[formcontrolname="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('text=Sign In')).toBeVisible();
    await expect(page.locator('text=ClothingERP')).toBeVisible();
  });

  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('should show error message with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[formcontrolname="email"]', 'wrong@example.com');
    await page.fill('input[formcontrolname="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.bg-red-50')).toContainText(/invalid|error|incorrect/i);
  });

  test('should logout and redirect to login page', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // Open user menu and click logout
    await page.locator('[matMenuTriggerFor="userMenu"]').click();
    await page.locator('button:has-text("Logout")').click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect protected routes to login when not authenticated', async ({ page }) => {
    // Clear any stored auth state
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('currentUser');
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/inventory/products');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/sales');
    await expect(page).toHaveURL(/\/login/);
  });
});
