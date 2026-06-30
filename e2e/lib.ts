import { APIRequestContext, Page, expect } from '@playwright/test';

/**
 * Shared E2E helpers — API auth + common POS UI flows.
 * Used by the system regression suite (smoke-api, journeys) and changes-new.
 */

export const API = 'http://localhost:3000/api/v1';
export const BARCODE = '2000000000001'; // seeded: Levis 501 Original Jeans (~Rs.3999)

export async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@clothingerp.com', password: 'admin123' },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).data.accessToken;
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'X-Branch-Id': '1' };
}

// --- POS UI helpers (real Tailwind selectors) ---

export async function gotoPos(page: Page) {
  await page.goto('/pos');
  await expect(
    page.locator('input[placeholder="Scan barcode or search products..."]')
  ).toBeVisible({ timeout: 15000 });
}

export async function addItem(page: Page, barcode = BARCODE) {
  const search = page.locator('input[placeholder="Scan barcode or search products..."]');
  await search.fill(barcode);
  await search.press('Enter');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
}

export async function payCashExact(page: Page) {
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.locator('button:has-text("Add cash")').click();
  await expect(page.locator('text=Fully Paid')).toBeVisible();
}
