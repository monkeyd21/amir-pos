import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
  });

  test('renders with heading and tabs', async ({ page }) => {
    await expect(page.getByText('Settings').first()).toBeVisible();
    for (const tab of ['General', 'Branches', 'Users', 'Integrations']) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('Branches tab exposes Add Branch', async ({ page }) => {
    await page.getByRole('button', { name: 'Branches' }).click();
    await expect(page.getByRole('button', { name: /Add Branch/i })).toBeVisible({ timeout: 10000 });
  });
});
