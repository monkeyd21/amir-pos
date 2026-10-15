import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API } from './lib';

/**
 * The business dashboard (client spec v4.5): zones, period tabs, side panels,
 * the rearrangeable layout, and the role-trimmed view (§11A).
 */
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page, request }) => {
    // Every test starts from the default layout.
    const res = await request.post(`${API}/auth/login`, { data: { email: 'admin@clothingerp.com', password: 'admin123' } });
    const token = (await res.json()).data.accessToken;
    await request.delete(`${API}/dashboard/layout/desktop`, { headers: { Authorization: `Bearer ${token}` } });
    await login(page);
  });

  test('loads the top bar with the live indicator and period tabs', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('live-indicator')).toBeVisible({ timeout: 10000 });
    for (const tab of ['Today', 'Week', 'Month', 'Custom']) {
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('shows the sales row, basket strip and bottom row', async ({ page }) => {
    const main = page.locator('main');
    for (const label of ['Total Sales', 'Bills Raised', 'Avg Bill Value', 'Gross Profit & Margin', 'Payment Mode Split', 'Recent Transactions', 'Active Alerts']) {
      await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(main.getByText('UPT', { exact: true })).toBeVisible();
    await expect(main.getByText('Daily Actionable', { exact: true })).toBeVisible();
  });

  test('switching to Week compares against last week', async ({ page }) => {
    await page.getByRole('tab', { name: 'Week', exact: true }).click();
    await expect(page.locator('[data-box-id="total-sales"]').getByText('vs last week')).toBeVisible();
  });

  test('a card opens its side panel, and Escape closes it', async ({ page }) => {
    await page.locator('[data-box-id="total-sales"] .kpi-card').click();
    const panel = page.getByRole('dialog', { name: 'Sales breakdown' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('By category')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('a box moved with the keyboard stays moved after a reload', async ({ page }) => {
    const order = () => page.locator('[data-box-id]').evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLElement).dataset['boxId']));
    await expect.poll(order, { timeout: 10000 }).toEqual(['total-sales', 'bills']);
    await page.locator('[data-box-id="total-sales"] .dash-handle--move').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(order).toEqual(['bills', 'total-sales']);
    await page.waitForTimeout(900); // saved after a short debounce
    await page.reload();
    await expect.poll(order, { timeout: 10000 }).toEqual(['bills', 'total-sales']);
  });

  test('sidebar links navigate between modules', async ({ page }) => {
    const nav = page.locator('app-sidebar');
    await nav.locator('a[href="/sales"]').click();
    await expect(page).toHaveURL(/\/sales/);
    await nav.locator('a[href="/customers"]').click();
    await expect(page).toHaveURL(/\/customers/);
    await nav.locator('a[href="/inventory"]').click();
    await expect(page).toHaveURL(/\/inventory/);
  });
});

test('a cashier sees only their own figures (§11A)', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[formcontrolname="email"]', 'cashier@clothingerp.com');
  await page.fill('input[formcontrolname="password"]', 'cashier123');
  await page.click('button[type="submit"]');
  // Billing roles land on the till.
  await page.waitForURL('**/pos');
  await page.goto('/dashboard');
  const main = page.locator('main');
  await expect(main.getByText('UPT', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(main.getByText('Your bills only')).toBeVisible();
  for (const hidden of ['Total Sales', 'Gross Profit & Margin', 'Payment Mode Split', 'Daily Actionable']) {
    await expect(main.getByText(hidden, { exact: true })).toHaveCount(0);
  }
});
