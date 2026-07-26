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
  // District-qualified so the agent resolves directly to a search (a bare city that is ALSO a region
  // — e.g. الرياض — correctly triggers a city-vs-region clarification instead; see the clarification
  // test below). Verified live: this query returns a full summary + ~986 results.
  await composer.fill('أبغى شقة للإيجار السنوي في حي النرجس بالرياض');
  await composer.press('Enter');

  // Wait for the results line (only appears after the full classify + search), then read the page
  // text ONCE and assert all classification tokens — avoids racing the streaming per-token render.
  await expect(page.getByText(FOUND).first()).toBeVisible({ timeout: 60_000 });
  const body = await page.locator('body').innerText();
  expect(body).toContain('ملخص البحث'); // Arabic summary rendered
  expect(body).toContain('شقة');        // type = Apartment
  expect(body).toContain('الرياض');     // city = Riyadh
  expect(body).toMatch(/للإيجار/);      // deal = Rent
});

test('AI mode — a city that is also a region asks to disambiguate (no wrong guess)', async ({ page }) => {
  await home(page);
  await page.getByText('الوكيل الذكي', { exact: true }).click();
  const composer = page.getByPlaceholder('اكتب ما تبحث عنه...');
  await composer.fill('شقة للإيجار في الرياض');
  await composer.press('Enter');
  // «الرياض» is both a city and a region → the agent must ASK, not silently pick one (anti-guess).
  await expect(page.getByText(/مدينة الرياض ولا منطقة الرياض/).first()).toBeVisible({ timeout: 60_000 });
});
