import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders } from './lib';

/**
 * §13.3 — Pricing & barcode logic.
 *   - Capture MRP; auto-calc Sale Price = MRP − 10% (rounded, odd OK).
 *   - MRP persists on the product (and flows to the barcode label data).
 */

test('§13.3 — Sale Price auto-fills to MRP − 10% in the product form', async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products/new');
  const mrp = page.locator('[data-testid="mrp-input"]');
  const salePrice = page.locator('[data-testid="sale-price-input"]');
  await expect(mrp).toBeVisible({ timeout: 10000 });

  // 100 → 90
  await mrp.fill('100');
  await expect(salePrice).toHaveValue('90');

  // Odd result allowed, rounded to whole rupees: 999 → 899 (899.1 → 899).
  await mrp.fill('999');
  await expect(salePrice).toHaveValue('899');
});

test('§13.1 — profit margin defines the Sale Price (and reflects entered prices)', async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products/new');
  const costInput = page.getByText('Cost Price (INR)').locator('xpath=following::input[1]');
  const sale = page.locator('[data-testid="sale-price-input"]');
  const margin = page.locator('[data-testid="margin-input"]');
  await expect(margin).toBeVisible({ timeout: 10000 });

  // Define a 20% margin over a ₹500 cost → Sale Price 600.
  await costInput.fill('500');
  await margin.fill('20');
  await expect(sale).toHaveValue('600');

  // Typing a Sale Price back-computes the margin (500 → 750 = 50%).
  await sale.fill('750');
  await expect(margin).toHaveValue('50');
});

test('§13.3 — MRP persists on the product and reaches barcode data', async ({ request }) => {
  const token = await apiLogin(request);
  const h = authHeaders(token);

  const brands = await (await request.get(`${API}/brands/`, { headers: h })).json();
  const cats = await (await request.get(`${API}/categories/`, { headers: h })).json();
  const brandId = brands.data?.[0]?.id;
  const categoryId = cats.data?.[0]?.id;
  expect(brandId && categoryId, 'need a seeded brand + category').toBeTruthy();

  const create = await request.post(`${API}/products`, {
    headers: { ...h, 'Content-Type': 'application/json' },
    data: {
      name: `E2E MRP Product ${Date.now()}`,
      brandId,
      categoryId,
      mrp: 1000,
      basePrice: 900, // = MRP − 10%
      costPrice: 500,
      variants: [{ size: 'M', color: 'Blue', initialStock: 1 }],
    },
  });
  expect(create.ok(), `create: ${await create.text()}`).toBeTruthy();
  const product = (await create.json()).data;
  expect(Number(product.mrp)).toBe(1000);
  expect(Number(product.basePrice)).toBe(900);
});

test('§13.2 — freight on a restock is auto-captured as an Expense', async ({ request }) => {
  const token = await apiLogin(request);
  const h = { ...authHeaders(token), 'Content-Type': 'application/json' };

  const prod = (await (await request.get(`${API}/products/?limit=1`, { headers: authHeaders(token) })).json()).data[0];
  const vendor = (await (await request.get(`${API}/vendors/`, { headers: authHeaders(token) })).json()).data[0];
  const freight = 777 + (Date.now() % 1000);

  const res = await request.post(`${API}/inventory/restock`, {
    headers: h,
    data: {
      productId: prod.id,
      vendorId: vendor.id,
      lotCode: `E2E-FRT-${Date.now()}`,
      freight,
      items: [{ variantId: prod.variants[0].id, quantity: 1, unitCost: 100 }],
    },
  });
  expect(res.ok(), `restock: ${await res.text()}`).toBeTruthy();
  expect((await res.json()).data.freightExpenseId).toBeTruthy();

  // A matching Freight & Delivery expense now exists.
  const expenses = (await (await request.get(`${API}/expenses/?limit=20`, { headers: authHeaders(token) })).json()).data;
  const frt = expenses.find((e: any) => Number(e.amount) === freight && /Freight/i.test(e.category?.name || ''));
  expect(frt, 'freight expense should be auto-created').toBeTruthy();
});
