import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, BARCODE } from './lib';

/**
 * §5 — Streamlined Customer Creation.
 *   §5.1 unrecognized phone auto-prompts new-customer creation
 *   §5.2 the searched phone is pre-filled (no re-entry)
 *   §5.3 DOB + Gender are mandatory new-customer fields
 *   §5.4 legacy customers (missing DOB/gender) are prompted to update
 *   §5.5 birthday shown for an existing customer at POS
 *   §5.6 rule-based size/category suggestion from the last 3 purchases
 */

const CUST_SEARCH = 'input[placeholder="Search customer by name, phone..."]';

test('§5.1/5.2/5.3/5.5 — new phone auto-prompts create with phone prefilled, DOB+gender required, birthday shows', async ({ page }) => {
  await login(page);
  await gotoPos(page);
  const phone = '9' + String(Date.now()).slice(-9);

  await page.locator(CUST_SEARCH).fill(phone);

  // §5.1 — the add-customer dialog auto-opens; §5.2 — phone is pre-filled.
  await expect(page.getByText('Create a new customer record')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[formcontrolname="phone"]')).toHaveValue(phone);

  // §5.3 — saving without DOB/gender is blocked (required).
  await page.locator('input[formcontrolname="firstName"]').fill('Autotest');
  await page.getByRole('button', { name: 'Add Customer' }).click();
  await expect(page.getByText('Date of birth is required')).toBeVisible();
  await expect(page.getByText('Gender is required')).toBeVisible();

  // Fill them and save.
  await page.locator('[data-testid="customer-dob"]').fill('1990-05-15');
  await page.locator('label:has([data-testid="gender-m"])').click();
  await page.getByRole('button', { name: 'Add Customer' }).click();

  // §5.5 — the created customer is selected and its birthday is shown.
  await expect(page.getByText(/Birthday 15 May/)).toBeVisible({ timeout: 10000 });
});

test('§5.4 — a legacy customer without DOB/gender is prompted to update', async ({ page, request }) => {
  const token = await apiLogin(request);
  const phone = '9' + String(Date.now() + 7).slice(-9);
  // Legacy customer: no DOB / gender.
  const res = await request.post(`${API}/customers`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: { firstName: 'Legacy', phone },
  });
  expect(res.ok()).toBeTruthy();

  await login(page);
  await gotoPos(page);
  await page.locator(CUST_SEARCH).fill(phone);
  await page.locator('button:has-text("Legacy")').first().click();
  await expect(page.locator('[data-testid="legacy-update-prompt"]')).toBeVisible({ timeout: 10000 });
});

test('§5.6 — suggestion appears after 3 purchases (rule-based MODE)', async ({ request }) => {
  const token = await apiLogin(request);
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };
  const phone = '9' + String(Date.now() + 13).slice(-9);
  const cust = (await (await request.post(`${API}/customers`, { headers: h, data: { firstName: 'Frequent', phone } })).json()).data;

  // Cold start → nothing suggested.
  const cold = await (await request.get(`${API}/customers/${cust.id}/suggestion`, { headers: authHeaders(token) })).json();
  expect(cold.data.preferredSize).toBeNull();

  // Three purchases of the same seeded item (size 28).
  for (let i = 0; i < 3; i++) {
    const r = await request.post(`${API}/pos/checkout`, {
      headers: h,
      data: {
        items: [{ barcode: BARCODE, quantity: 1 }],
        payments: [{ method: 'cash', amount: 10000 }],
        customerId: cust.id,
        channel: 'walkin',
        clientRef: `e2e-sugg-${Date.now()}-${i}`,
      },
    });
    expect(r.ok(), `checkout ${i}: ${await r.text()}`).toBeTruthy();
  }

  const warm = await (await request.get(`${API}/customers/${cust.id}/suggestion`, { headers: authHeaders(token) })).json();
  expect(warm.data.preferredSize).toBe('28');
});
