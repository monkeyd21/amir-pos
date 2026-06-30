import { request } from '@playwright/test';
import { API, apiLogin, authHeaders } from './lib';

/**
 * Runs once before the suite. POS checkout journeys consume stock of the seeded
 * test item (variant 1 / barcode 2000000000001); top it up so the suite is
 * repeatable no matter how many times it has run against this dev DB.
 */
export default async function globalSetup() {
  const ctx = await request.newContext();
  try {
    const token = await apiLogin(ctx);
    await ctx.post(`${API}/inventory/adjust`, {
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      data: { variantId: 1, branchId: 1, quantity: 1000, reason: 'e2e stock top-up' },
    });
    // Ensure a POS session is open (checkout + EOD tests need one). The §8 EOD
    // tests close it; they re-open in afterAll. Ignore "already open".
    await ctx.post(`${API}/pos/sessions/open`, {
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      data: { openingAmount: 1000 },
    });
  } finally {
    await ctx.dispose();
  }
}
