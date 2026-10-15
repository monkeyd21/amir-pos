import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders } from './lib';

/**
 * §10 — Business Performance Dashboard.
 *   §10.1 overall: Total Sales / Cost / Profit / Avg Profit %
 *   §10.2 day-of-week performance + Best/Strong/Good/Slow ratings
 *   §10.3 monthly sales/profit/margin + insights
 */

test('§10.1/10.2/10.3 — performance endpoint computes profit, day-of-week, monthly', async ({ request }) => {
  const token = await apiLogin(request);
  const data = (await (await request.get(`${API}/reports/performance`, { headers: authHeaders(token) })).json()).data;

  // §10.1 — profit math: profit = sales − cost; margin = profit/sales.
  const o = data.overall;
  expect(o.totalProfit).toBeCloseTo(o.totalSales - o.totalCost, 1);
  if (o.totalSales > 0) {
    expect(o.avgProfitPercent).toBeCloseTo((o.totalProfit / o.totalSales) * 100, 0);
  }
  // §10.2 — seven weekday buckets, each rated.
  expect(data.dayOfWeek).toHaveLength(7);
  for (const d of data.dayOfWeek) {
    expect(['Best', 'Strong', 'Good', 'Slow']).toContain(d.rating);
  }
  // §10.3 — monthly rows carry a margin %, and insights name a best month/day.
  if (data.monthly.length) {
    expect(data.monthly[0]).toHaveProperty('marginPercent');
    expect(data.insights.bestMonth).toBeTruthy();
  }
  // §10.4 — rule-based proactive recommendations are returned.
  expect(Array.isArray(data.recommendations)).toBeTruthy();
});

// The dashboard's own profit card replaced the old "Business Performance"
// panel; dashboard.spec.ts covers it. This endpoint still backs Reports.
