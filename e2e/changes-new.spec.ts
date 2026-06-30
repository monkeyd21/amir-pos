import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { login } from './helpers';

/**
 * End-to-end verification for the "Changes NEW" quick-wins batch.
 * Drives the real Angular POS UI against the real backend + Postgres.
 *
 *   §1.2  — Non-Returnable flag is printed on the receipt
 *   §6.2b — At most 2 vouchers per bill (UI guard) + backend cap
 *   §6.1c — Customer-bound voucher is non-transferable (checkout rejects)
 *   §6.2c — New vouchers default to a 180-day expiry (backend rule)
 *
 * §7.1c (3 long invalid-scan beeps) is Web-Audio output — not assertable via
 * Playwright; verified by ear / unit, see changes-new.md.
 */

const API = 'http://localhost:3000/api/v1';
const BARCODE = '2000000000001'; // seeded: Levis 501, ~Rs.3999

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@clothingerp.com', password: 'admin123' },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.accessToken;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'X-Branch-Id': '1' };
}

async function createVoucher(
  request: APIRequestContext,
  token: string,
  value: number,
  extra: { customerId?: number; expiresAt?: string | null } = {}
): Promise<{ code: string; expiresAt: string | null; customerId: number | null }> {
  const res = await request.post(`${API}/vouchers`, {
    headers: authHeaders(token),
    data: { value, ...extra },
  });
  expect(res.ok(), `voucher create failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

async function createCustomer(
  request: APIRequestContext,
  token: string,
  firstName: string,
  seed: number
): Promise<{ id: number; phone: string; firstName: string }> {
  const phone = '9' + String(Date.now() + seed).slice(-9);
  const res = await request.post(`${API}/customers`, {
    headers: authHeaders(token),
    data: { firstName, phone },
  });
  expect(res.ok(), `customer create failed: ${await res.text()}`).toBeTruthy();
  const data = (await res.json()).data;
  return { id: data.id, phone, firstName };
}

// --- POS UI helpers (real Tailwind selectors, not the stale Material specs) ---

async function gotoPos(page: Page) {
  await login(page);
  await page.goto('/pos');
  await expect(
    page.locator('input[placeholder="Scan barcode or search products..."]')
  ).toBeVisible({ timeout: 15000 });
}

async function addItem(page: Page, barcode = BARCODE) {
  const search = page.locator('input[placeholder="Scan barcode or search products..."]');
  await search.fill(barcode);
  await search.press('Enter');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
}

async function applyVoucher(page: Page, code: string) {
  await page.locator('input[placeholder="Gift voucher code"]').fill(code);
  await page.locator('button:has-text("Apply")').click();
}

test.describe('Changes NEW — quick wins (E2E)', () => {
  test('§1.2 — non-returnable item is flagged on the printed receipt', async ({ page }) => {
    await gotoPos(page);
    await addItem(page);

    // Flag the line as sold-as-is (non-returnable) via the cart toggle.
    const flagBtn = page.locator('button[title^="Mark sold as-is"]').first();
    await flagBtn.click();
    // Title flips once the flag is on.
    await expect(page.locator('button[title^="Sold as-is"]').first()).toBeVisible();

    // Pay full amount in cash and complete the sale.
    await page.locator('[data-testid="proceed-to-payment"]').click(); // §2.5 gate
    await page.getByRole('button', { name: 'Exact' }).click();
    await page.locator('button:has-text("Add cash")').click();
    await expect(page.locator('text=Fully Paid')).toBeVisible();

    // Completing the sale auto-opens the receipt in a popup window.
    const popupPromise = page.waitForEvent('popup');
    await page.locator('button:has-text("Complete Sale")').click();
    const receipt = await popupPromise;
    await receipt.waitForLoadState('domcontentloaded');

    // The receipt must mark the non-returnable line + carry the legend.
    await expect(receipt.locator('text=NON-RETURNABLE').first()).toBeVisible({ timeout: 10000 });
    await expect(
      receipt.locator('text=NON-RETURNABLE items cannot be returned')
    ).toBeVisible();
  });

  test('§6.2b — POS blocks a 3rd voucher on one bill', async ({ page, request }) => {
    const token = await apiLogin(request);
    // Small vouchers so two of them don't clear the ~Rs.3999 bill.
    const v1 = await createVoucher(request, token, 10);
    const v2 = await createVoucher(request, token, 10);
    const v3 = await createVoucher(request, token, 10);

    await gotoPos(page);
    await addItem(page);

    await applyVoucher(page, v1.code);
    await expect(page.locator('text=' + v1.code)).toBeVisible({ timeout: 8000 });
    await applyVoucher(page, v2.code);
    await expect(page.locator('text=' + v2.code)).toBeVisible({ timeout: 8000 });

    // Third one must be refused with the cap warning toast.
    await applyVoucher(page, v3.code);
    await expect(page.getByText('A bill can use at most 2 vouchers')).toBeVisible({ timeout: 8000 });
  });

  test('§6.1c — a customer-bound voucher cannot be redeemed on another customer\'s bill', async ({
    page,
    request,
  }) => {
    const token = await apiLogin(request);
    const custA = await createCustomer(request, token, 'VoucherOwnerA', 1);
    const custB = await createCustomer(request, token, 'OtherCustB', 2);
    // Voucher registered to customer A.
    const voucher = await createVoucher(request, token, 100, { customerId: custA.id });

    await gotoPos(page);

    // Select customer B on the bill.
    const custSearch = page.locator('input[placeholder="Search customer by name, phone..."]');
    await custSearch.fill(custB.phone);
    await page.locator(`button:has-text("${custB.firstName}")`).first().click();
    await expect(page.locator(`text=${custB.firstName}`).first()).toBeVisible();

    await addItem(page);

    // Lookup succeeds (ownership is enforced at redemption, not lookup) ...
    await applyVoucher(page, voucher.code);
    await expect(page.locator('text=' + voucher.code)).toBeVisible({ timeout: 8000 });

    // ... but completing the sale must be rejected for the wrong customer.
    await page.locator('[data-testid="proceed-to-payment"]').click(); // §2.5 gate
    await page.getByRole('button', { name: 'Exact' }).click();
    await page.locator('button:has-text("Add cash")').click();
    await page.locator('button:has-text("Complete Sale")').click();

    await expect(
      page.getByText(/another customer|non-transferable/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('§6.2c — a new voucher defaults to a 180-day expiry', async ({ request }) => {
    const token = await apiLogin(request);
    const before = Date.now();
    const voucher = await createVoucher(request, token, 50); // no expiry supplied
    expect(voucher.expiresAt).toBeTruthy();

    const expiry = new Date(voucher.expiresAt as string).getTime();
    const days = (expiry - before) / (1000 * 60 * 60 * 24);
    // Allow a day of slack for clock/timezone rounding.
    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThan(181);
  });
});
