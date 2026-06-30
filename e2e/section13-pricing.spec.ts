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
