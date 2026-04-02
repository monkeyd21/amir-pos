import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/settings/);
    // Settings uses placeholder component with title "Settings"
    await expect(page.locator('text=Settings')).toBeVisible();
  });

  test('should show Coming Soon placeholder content', async ({ page }) => {
    await page.goto('/settings');

    // Placeholder component renders "Coming Soon" message
    await expect(page.locator('text=Coming Soon')).toBeVisible();
    await expect(page.locator('text=This module will be available in a future update')).toBeVisible();
  });

  test('should be accessible via sidebar navigation', async ({ page }) => {
    await page.goto('/dashboard');

    await page.locator('app-sidebar a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
