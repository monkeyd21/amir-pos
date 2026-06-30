import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { API, apiLogin, authHeaders } from './lib';

/**
 * Backend regression net — hits a safe read endpoint on EVERY module and
 * asserts it still returns 200 + { success: true }. Catches the most common
 * breakage from new code: a route that now throws 500, a broken contract, or
 * an accidentally-removed endpoint. Fast and data-independent.
 *
 * Baseline captured live on 2026-06-30 (all green). When you ADD a module or
 * endpoint, add a line here so the net keeps pace.
 */

// Every entry is expected to return HTTP 200 with { success: true }.
const READ_ENDPOINTS: string[] = [
  // catalogue / masters
  '/branches/',
  '/brands/',
  '/categories/',
  '/colors/',
  '/products/',
  '/vendors/',
  // inventory
  '/inventory/',
  '/inventory/low-stock',
  '/inventory/movements',
  // customers + loyalty
  '/customers/',
  '/customers/top',
  '/customers/search?q=a',
  '/loyalty/config',
  // POS
  '/pos/catalog',
  '/pos/held',
  '/pos/sessions/current',
  '/pos/products/search?q=a',
  // sales / vouchers
  '/sales/',
  '/vouchers/',
  // staff
  '/users/',
  '/users/me',
  '/employees/',
  '/employees/attendance',
  '/employees/commissions',
  // money
  '/expenses/',
  '/expenses/categories',
  '/expenses/summary?startDate=2026-01-01&endDate=2026-12-31',
  '/payments/summary',
  '/offers/',
  // accounting
  '/accounting/accounts',
  '/accounting/pnl?startDate=2026-01-01&endDate=2026-12-31',
  '/accounting/trial-balance?asOfDate=2026-12-31',
  // reports
  '/reports/daily-summary',
  '/reports/inventory',
  '/reports/customers',
  '/reports/sales?startDate=2026-01-01&endDate=2026-12-31',
  '/reports/commissions?startDate=2026-01-01&endDate=2026-12-31',
  // settings / misc
  '/settings/bill-numbering',
  '/settings/commission-mode',
  '/settings/messaging',
  '/messaging/logs',
];

test.describe('API smoke — every module responds', () => {
  let token: string;
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    ctx = await pwRequest.newContext();
    token = await apiLogin(ctx);
  });

  test.afterAll(async () => {
    await ctx.dispose();
  });

  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API}/customers/`);
    expect(res.status()).toBe(401);
  });

  for (const ep of READ_ENDPOINTS) {
    test(`GET ${ep}`, async ({ request }) => {
      const res = await request.get(`${API}${ep}`, { headers: authHeaders(token) });
      expect(res.status(), `unexpected status for ${ep}`).toBe(200);
      const body = await res.json();
      expect(body.success, `success!=true for ${ep}`).toBe(true);
    });
  }
});
