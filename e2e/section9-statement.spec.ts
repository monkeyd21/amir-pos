import { test, expect, APIRequestContext } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, BARCODE } from './lib';

/**
 * §9.2 — monthly commission statement: original → deductions → net per employee.
 * Ensures a commission exists (agent rate → sale → payroll calc), then checks
 * the statement math (API) and the commissions-page view (UI).
 */

async function ensureCommission(request: APIRequestContext, token: string) {
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };
  await request.put(`${API}/employees/1`, { headers: h, data: { commissionRate: 10 } });
  await request.post(`${API}/pos/checkout`, {
    headers: h,
    data: {
      items: [{ barcode: BARCODE, quantity: 1, agentId: 1 }],
      payments: [{ method: 'cash', amount: 10000 }],
      channel: 'walkin',
      clientRef: `e2e-stmt-${Date.now()}`,
    },
  });
  await request.get(`${API}/employees/commissions/calculate?startDate=2026-06-01&endDate=2026-06-30`, {
    headers: authHeaders(token),
  });
}

test.beforeAll(async ({ request }) => {
  const token = await apiLogin(request);
  await ensureCommission(request, token);
});

test.afterAll(async ({ request }) => {
  const token = await apiLogin(request);
  await request.put(`${API}/employees/1`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { commissionRate: 0 },
  });
});

test('§9.2 — statement math: net = original − deductions per employee', async ({ request }) => {
  const token = await apiLogin(request);
  const data = (await (await request.get(
    `${API}/employees/commissions/statement?startDate=2026-06-01&endDate=2026-06-30`,
    { headers: authHeaders(token) }
  )).json()).data;

  expect(Array.isArray(data.rows)).toBeTruthy();
  expect(data.rows.length).toBeGreaterThan(0);
  for (const r of data.rows) {
    expect(r.net).toBeCloseTo(r.original - r.deductions, 1);
    expect(r.name).toBeTruthy();
  }
});

test('§9.2 — commissions page shows the statement (original/deductions/net)', async ({ page }) => {
  await login(page);
  await page.goto('/employees/commissions');
  const stmt = page.locator('[data-testid="commission-statement"]');
  await expect(stmt).toBeVisible({ timeout: 10000 });
  await expect(stmt.getByText('Original')).toBeVisible();
  await expect(stmt.getByText('Deductions')).toBeVisible();
  await expect(stmt.getByText('Net', { exact: true })).toBeVisible();
});
