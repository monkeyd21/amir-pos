import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API, apiLogin, authHeaders, gotoPos, addItem, payCashExact, proceedToPayment, BARCODE } from './lib';

/**
 * UI verification for already-built spec items in sections 1, 2, 4, 7.
 *   §1.1 arrow keys disabled on discount/redeem inputs
 *   §1.3 non-returnable goods blocked from return
 *   §2.3 payment identifier captured for card/UPI
 *   §4.1 / §4.2 hold remarks saved + shown on retrieval
 *   §7.1a-d distinct scan-audio cues (valid / duplicate / invalid), wired into POS
 */

test.describe('§1.1 — arrow keys disabled on money inputs', () => {
  test('ArrowUp does not change the manual discount value', async ({ page }) => {
    await login(page);
    await gotoPos(page);
    await addItem(page);
    const discount = page.locator('input[appnospin]').first();
    await discount.fill('5');
    await discount.focus();
    await discount.press('ArrowUp');
    await discount.press('ArrowUp');
    await expect(discount).toHaveValue('5');
  });
});

test.describe('§4 — hold remarks', () => {
  test('remarks are saved on hold and shown when retrieving', async ({ page }) => {
    await login(page);
    await gotoPos(page);
    await addItem(page);
    const remark = `E2E hold ${Date.now()}`;
    await page
      .locator('input[placeholder^="Remarks for held bill"]')
      .fill(remark);
    await page.getByRole('button', { name: 'Hold' }).click();
    // Cart clears on a successful hold.
    await expect(page.locator('text=Search or scan products to add them here')).toBeVisible({ timeout: 10000 });
    // Open the held panel and find our remark.
    await page.getByRole('button', { name: 'Held' }).click();
    await expect(page.getByText('Held Bills')).toBeVisible();
    await expect(page.getByText(remark)).toBeVisible();
  });
});

test.describe('§7.1 — scan audio cues', () => {
  test('valid / duplicate / invalid produce distinct beep patterns', async ({ page }) => {
    // Spy on Web Audio: record each oscillator's frequency at start().
    await page.addInitScript(() => {
      (window as any).__beeps = [];
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      const origCreate = Ctor.prototype.createOscillator;
      Ctor.prototype.createOscillator = function () {
        const osc = origCreate.call(this);
        const origStart = osc.start.bind(osc);
        osc.start = (when?: number) => {
          (window as any).__beeps.push(Math.round(osc.frequency.value));
          return origStart(when as any);
        };
        return osc;
      };
    });
    await login(page);
    await gotoPos(page);

    const search = page.locator('input[placeholder="Scan barcode or search products..."]');
    const beeps = () => page.evaluate(() => (window as any).__beeps as number[]);
    const reset = () => page.evaluate(() => ((window as any).__beeps = []));

    // Valid scan → 1 high beep (~1320 Hz).
    await reset();
    await search.fill(BARCODE);
    await search.press('Enter');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
    await expect.poll(beeps).toEqual([1320]);

    // Duplicate scan → 2 beeps (~880 Hz).
    await reset();
    await search.fill(BARCODE);
    await search.press('Enter');
    await expect.poll(beeps).toEqual([880, 880]);

    // Invalid scan → 3 long beeps (~620 Hz).
    await reset();
    await search.fill('0000000000000');
    await search.press('Enter');
    await expect.poll(beeps).toEqual([620, 620, 620]);
  });
});

test.describe('§2.3 — payment identifier captured', () => {
  test('a card identifier entered at checkout persists on the sale', async ({ page, request }) => {
    await login(page);
    await gotoPos(page);
    await addItem(page);

    // §2.5 — unlock payment, then switch to Card, enter a bank identifier.
    await proceedToPayment(page);
    await page.locator('button:has-text("Card")').first().click();
    const amountInput = page.locator('input[type="number"]').last();
    const remaining = await amountInput.getAttribute('placeholder');
    await page.locator('input[placeholder="Bank / account name (optional)"]').fill('HDFC Bank E2E');
    await amountInput.fill(remaining || '');
    await page.locator('button:has-text("Add card")').click();
    await expect(page.locator('text=Fully Paid')).toBeVisible();

    const popup = page.waitForEvent('popup');
    await page.locator('button:has-text("Complete Sale")').click();
    await expect(page.getByText(/Sale completed/i).first()).toBeVisible({ timeout: 10000 });
    await (await popup).waitForLoadState('domcontentloaded').catch(() => {});

    // Confirm the identifier persisted via the API (most-recent card payment).
    const token = await apiLogin(request);
    const res = await request.get(`${API}/sales/?limit=1`, { headers: authHeaders(token) });
    const body = await res.json();
    const saleId = body.data?.[0]?.id;
    const detail = await request.get(`${API}/sales/${saleId}`, { headers: authHeaders(token) });
    const sale = (await detail.json()).data;
    const cardPayment = (sale.payments || []).find((p: any) => p.method === 'card');
    expect(cardPayment?.identifier).toBe('HDFC Bank E2E');
  });
});

test.describe('§1.3 — non-returnable goods blocked from return', () => {
  test('returning a non-returnable line is rejected', async ({ page }) => {
    await login(page);
    await gotoPos(page);
    await addItem(page);
    // Flag the line non-returnable, then complete a cash sale.
    await page.locator('button[title^="Mark sold as-is"]').first().click();
    await payCashExact(page);
    const popup = page.waitForEvent('popup');
    await page.locator('button:has-text("Complete Sale")').click();
    await expect(page.getByText(/Sale completed/i).first()).toBeVisible({ timeout: 10000 });
    const saleNumber = (await page.getByText(/Sale completed/i).first().textContent())?.match(/[WO]-\d+/)?.[0];
    await (await popup).close().catch(() => {});

    // Open that sale and attempt a return.
    await page.goto('/sales');
    await page.getByText(saleNumber!).first().click();
    await expect(page).toHaveURL(/\/sales\//);
    await page.getByRole('button', { name: /Process Return/i }).click();
    await expect(page.getByText('Process Return').first()).toBeVisible();
    // Select the (only) line and submit — backend must reject it.
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator('button:has-text("Process Return")').last().click();
    await expect(page.getByText(/non-returnable/i).first()).toBeVisible({ timeout: 10000 });
  });
});
