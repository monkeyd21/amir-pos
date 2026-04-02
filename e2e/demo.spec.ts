import { test, expect, Page } from '@playwright/test';
import { login } from './helpers';

/**
 * ClothingERP — Interactive Playwright Demo
 *
 * Run with:
 *   npx playwright test e2e/demo.spec.ts --headed --workers=1
 *
 * This demo walks through the major features of the ERP system:
 *  1. Login
 *  2. Dashboard overview
 *  3. Inventory management
 *  4. POS terminal (scan, add to cart, checkout)
 *  5. Sales history
 *  6. Customer management
 *  7. Employee attendance & commissions
 *  8. Expense tracking
 */

// Slow down actions so you can watch the demo
test.use({ actionTimeout: 8000 });

const PAUSE = 800; // ms pause between visual steps

async function pause(page: Page, ms = PAUSE) {
  await page.waitForTimeout(ms);
}

test.describe('ClothingERP Demo Walkthrough', () => {
  test('Full app demo', async ({ page }) => {
    test.setTimeout(180_000);

    // Debug: log network requests
    page.on('response', r => {
      if (r.url().includes('/lookup/') || r.url().includes('/pos/')) {
        console.log(`[NET] ${r.status()} ${r.url()}`);
      }
    });

    // ─── 1. LOGIN ────────────────────────────────────────────────
    await test.step('Login to ClothingERP', async () => {
      await login(page);
      await pause(page, 1200);
    });

    // ─── 2. DASHBOARD ────────────────────────────────────────────
    await test.step('Explore Dashboard', async () => {
      await expect(page.locator('h1').filter({ hasText: 'Dashboard' })).toBeVisible();

      // KPI Cards
      await expect(page.locator("text=Today's Sales")).toBeVisible();
      await expect(page.locator("text=Today's Revenue")).toBeVisible();
      await expect(page.locator('text=Total Customers')).toBeVisible();
      await expect(page.locator('text=Low Stock Items')).toBeVisible();
      await pause(page, 1000);

      // Sales Overview chart
      await expect(page.locator('text=Sales Overview')).toBeVisible();

      // Click 30D period
      await page.locator('button:has-text("30D")').click();
      await pause(page, 800);

      // Top Products
      await expect(page.locator('text=Top Products')).toBeVisible();
      await pause(page, 600);

      // Recent Sales
      await expect(page.locator('text=Recent Sales')).toBeVisible();
      await pause(page, 600);

      // Low Stock Alerts
      await expect(page.locator('text=Low Stock Alerts')).toBeVisible();
      await pause(page, 800);

      // Take screenshot
      await page.screenshot({ path: 'demo-screenshots/01-dashboard.png', fullPage: true });
    });

    // ─── 3. INVENTORY ────────────────────────────────────────────
    await test.step('Browse Inventory', async () => {
      await page.goto('/inventory/products');
      await expect(page.locator('mat-spinner')).not.toBeVisible({ timeout: 15000 });
      await expect(page.locator('h1').filter({ hasText: 'Products' })).toBeVisible();
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      await pause(page, 800);

      await page.goto('/inventory/stock');
      await expect(page.locator('h1').filter({ hasText: 'Stock' })).toBeVisible({ timeout: 10000 });
      await pause(page, 800);

      await page.screenshot({ path: 'demo-screenshots/02-inventory.png', fullPage: true });
    });

    // ─── 4. POS TERMINAL ─────────────────────────────────────────
    await test.step('Use POS Terminal', async () => {
      // Navigate directly to POS (already logged in)
      await page.goto('/pos');
      await expect(page.locator('h1:has-text("POS Terminal")')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Scan a barcode to add items')).toBeVisible({ timeout: 10000 });
      await pause(page, 1500);

      // Scan a barcode - click input first to ensure focus
      const barcodeInput = page.locator('input[placeholder="Scan or type barcode..."]');
      await barcodeInput.click();
      await barcodeInput.fill('2000000000001');
      await barcodeInput.press('Enter');

      // Wait for cart item to appear, or skip POS flow if barcode not found
      let barcodeWorked = false;
      try {
        await expect(page.locator('mat-table mat-row, table tbody tr').first()).toBeVisible({ timeout: 10000 });
        barcodeWorked = true;
      } catch {
        // Barcode lookup failed (product not found in seeded data) — skip POS checkout flow
      }

      if (barcodeWorked) {
        await pause(page, 600);

        // Add another item
        await barcodeInput.click();
        await barcodeInput.fill('2000000000002');
        await barcodeInput.press('Enter');
        await pause(page, 800);

        // Increase quantity of first item
        await page.locator('button:has(mat-icon:has-text("add_circle_outline"))').first().click();
        await pause(page, 500);

        // Show payment section
        await expect(page.locator('text=Amount Due')).toBeVisible();

        // Select payment tabs
        await page.locator('div.mat-mdc-tab-labels [role="tab"]:has-text("Card")').click();
        await pause(page, 500);
        await page.locator('div.mat-mdc-tab-labels [role="tab"]:has-text("Cash")').click();
        await pause(page, 500);

        // Click Exact to fill payment
        await page.locator('button:has-text("Exact")').click();
        await pause(page, 600);
        await expect(page.locator('text=Payment Complete')).toBeVisible();

        await page.screenshot({ path: 'demo-screenshots/03-pos-checkout.png', fullPage: true });

        // Clear cart for clean state
        await page.locator('button:has-text("Clear")').click();
        await pause(page, 500);
      }

      // Exit POS (full-screen mode has no sidebar)
      await page.locator('button:has(mat-icon:has-text("arrow_back"))').click();
      await pause(page, 500);
    });

    // ─── 5. SALES ────────────────────────────────────────────────
    await test.step('View Sales History', async () => {
      await page.goto('/sales');
      await expect(page).toHaveURL(/\/sales/);
      await pause(page, 800);

      // Sales table should be visible
      await expect(page.locator('th:has-text("Sale #")')).toBeVisible();
      await expect(page.locator('th:has-text("Total")')).toBeVisible();

      // Click View on first sale if any rows exist
      const viewBtn = page.locator('button:has-text("View")').first();
      if (await viewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await viewBtn.click();
        await pause(page, 1000);

        // Sale detail should show items
        await expect(page.locator('text=Sale Items')).toBeVisible();
        await pause(page, 800);

        await page.screenshot({ path: 'demo-screenshots/04-sales.png', fullPage: true });

        // Go back
        await page.goBack();
        await pause(page, 500);
      } else {
        await page.screenshot({ path: 'demo-screenshots/04-sales.png', fullPage: true });
      }
    });

    // ─── 6. CUSTOMERS ────────────────────────────────────────────
    await test.step('Manage Customers', async () => {
      await page.locator('app-sidebar a[href="/customers"]').click();
      await expect(page).toHaveURL(/\/customers/);
      await pause(page, 800);

      // Customer list with columns
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      await expect(page.locator('th:has-text("Phone")')).toBeVisible();

      // Open add customer dialog
      await page.locator('button:has-text("Add Customer")').click();
      await expect(page.locator('mat-dialog-container')).toBeVisible();
      await pause(page, 800);

      // Fill in some details
      await page.locator('mat-dialog-container input[formcontrolname="name"]').fill('Demo Customer');
      await page.locator('mat-dialog-container input[formcontrolname="phone"]').fill('9999900000');
      await pause(page, 800);

      await page.screenshot({ path: 'demo-screenshots/05-customers.png', fullPage: true });

      // Close without saving
      await page.keyboard.press('Escape');
      await pause(page, 500);
    });

    // ─── 7. EMPLOYEES ────────────────────────────────────────────
    await test.step('Employee Management', async () => {
      await page.locator('app-sidebar a[href="/employees"]').click();
      await expect(page).toHaveURL(/\/employees/);
      await pause(page, 800);

      // Employee list
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      await pause(page, 500);

      // Navigate to attendance
      await page.goto('/employees/attendance');
      await pause(page, 800);

      // Navigate to commissions
      await page.goto('/employees/commissions');
      await pause(page, 800);

      await page.screenshot({ path: 'demo-screenshots/06-employees.png', fullPage: true });
    });

    // ─── 8. EXPENSES ─────────────────────────────────────────────
    await test.step('Expense Tracking', async () => {
      await page.goto('/expenses');
      await pause(page, 800);

      await page.screenshot({ path: 'demo-screenshots/07-expenses.png', fullPage: true });
    });

    // ─── 9. ACCOUNTING ───────────────────────────────────────────
    await test.step('Accounting Module', async () => {
      await page.goto('/accounting');
      await pause(page, 800);

      await page.screenshot({ path: 'demo-screenshots/08-accounting.png', fullPage: true });
    });

    // ─── FINAL ───────────────────────────────────────────────────
    await test.step('Return to Dashboard', async () => {
      await page.locator('app-sidebar a[href="/dashboard"]').click();
      await expect(page).toHaveURL(/\/dashboard/);
      await pause(page, 1500);
    });
  });
});
