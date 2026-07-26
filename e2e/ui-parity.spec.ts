import { test, expect, type Page } from '@playwright/test';

// Production-UI parity: drives the real app end-to-end (Filter mode + AI mode) and asserts the
// results actually render, in Arabic, with the right classification. Real clicks + Playwright
// auto-wait — no coordinate math, so it doesn't suffer the browser-pane's flakiness. Read-only
// (search only), safe to run against production.

const ARABIC = /[؀-ۿ]/;
const FOUND = /لقينا[\s\S]*?إعلان/; // "لقينا N إعلان يطابق طلبك" — the results summary line

async function home(page: Page) {
  await page.goto('/?fresh=e2e', { waitUntil: 'domcontentloaded' });
  // Wait for the form to hydrate (the Buy/Rent control is always present on home).
  await expect(page.getByText('شراء', { exact: true })).toBeVisible();
}

// Pick a city from the field's dropdown. The input value lives in an <input> (not matched by
// getByText), so getByText(city) resolves to the dropdown/trending option — click it.
async function pickCity(page: Page, city: string) {
  const input = page.locator('input').first();
  await input.click();
  await input.fill(city);
  await page.getByText(city, { exact: true }).first().click();
  await expect(input).toHaveValue(city);
}

async function runSearch(page: Page) {
  await page.getByText('بحث', { exact: true }).click();
  await expect(page.getByText(FOUND).first()).toBeVisible({ timeout: 60_000 });
}

test('Filter mode — Buy in Riyadh returns Arabic results', async ({ page }) => {
  await home(page);
  await page.getByText('شراء', { exact: true }).click(); // Buy (default, click to be explicit)
  await pickCity(page, 'الرياض');
  await runSearch(page);

  const summary = await page.getByText(FOUND).first().textContent();
  expect(summary && ARABIC.test(summary)).toBeTruthy();
  // A result card renders with a real external source (neutral aggregator behavior).
  await expect(page.getByText(/wasalt\.sa|aqar|\.sa|\.com/).first()).toBeVisible();
});

test('Filter mode — Rent + Monthly in Riyadh returns results', async ({ page }) => {
  await home(page);
  await page.getByText('إيجار', { exact: true }).click();   // Rent
  await page.getByText('شهري', { exact: true }).click();     // Monthly period
  await pickCity(page, 'الرياض');
  await runSearch(page);
  await expect(page.getByText(FOUND).first()).toBeVisible();
});

test('Filter mode — Apartment type filter returns results', async ({ page }) => {
  await home(page);
  await pickCity(page, 'الرياض');
  await page.getByText('الشقق والسكن المشترك', { exact: true }).click(); // group
  await page.getByText('شقة', { exact: true }).click();                   // type
  await runSearch(page);
  await expect(page.getByText(FOUND).first()).toBeVisible();
});

test('AI mode — free-text query classifies correctly, replies in Arabic', async ({ page }) => {
  await home(page);
  await page.getByText('الوكيل الذكي', { exact: true }).click(); // switch to AI mode
  const composer = page.getByPlaceholder('اكتب ما تبحث عنه...');
  await expect(composer).toBeVisible();
  await composer.fill('أبغى شقة للإيجار السنوي في الرياض');
  await composer.press('Enter');

  // The agent's search summary must render with the right classification, all Arabic.
  await expect(page.getByText('ملخص البحث').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('شقة').first()).toBeVisible();       // type
  await expect(page.getByText('الرياض').first()).toBeVisible();    // city
  await expect(page.getByText(/للإيجار/).first()).toBeVisible();   // deal = Rent
  await expect(page.getByText(FOUND).first()).toBeVisible();       // results shown
});
