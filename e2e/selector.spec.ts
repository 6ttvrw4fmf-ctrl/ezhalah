import { test, expect, type Page, type Locator } from '@playwright/test';

// PERMANENT SELECTOR BARRIER (2026-08-14, findings P1–P7): one tap on the City/District fields must
// ALWAYS open something, the district multi-select must genuinely stay open across picks, the
// blur→quick-refocus race must never strand a dead selector, and the LOC_IMG visual identity + the
// Arabic-only surface must hold. Runs against live production (read-only — no search is submitted),
// on a schedule + after every production deploy (.github/workflows/selector-e2e.yml), raising /
// self-healing a P2 alert (kind selector_e2e). Real clicks + auto-wait; RNW maps testID →
// data-testid, so the hooks here are stable regardless of copy or layout changes.

const LATIN = /[A-Za-z]/;

async function home(page: Page) {
  await page.goto('/?fresh=e2e', { waitUntil: 'domcontentloaded' });
  // Wait for the form to hydrate (the Buy/Rent control is always present on home).
  await expect(page.getByText('شراء', { exact: true })).toBeVisible({ timeout: 30_000 });
}

// toBeVisible() ignores opacity, and the dropdown fades in via rAF (findings P6) — so the barrier
// asserts the EFFECTIVE opacity (the product down the ancestor chain) is actually ≳1, not merely
// that the node exists at opacity 0.02 mid-freeze.
async function effectiveOpacity(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    let o = 1;
    for (let n: Element | null = node; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1');
    return o;
  });
}

const cityInput = (page: Page) => page.getByTestId('city-input');
const districtInput = (page: Page) => page.getByTestId('district-input');
const trendingRows = (page: Page) => page.getByTestId('trending-row');

// Shared step: pick الرياض via typed search (deterministic — the Top-6 ordering can shift with
// inventory, typing can't). Leaves the city confirmed and the district field enabled.
async function pickRiyadh(page: Page) {
  await cityInput(page).click();
  await cityInput(page).fill('الري');
  await page.getByText('الرياض', { exact: true }).first().click();
  await expect(page.getByTestId('selected-city-visual')).toBeVisible({ timeout: 10_000 });
}

test('a. one tap opens the city dropdown at full opacity', async ({ page }) => {
  await home(page);
  await cityInput(page).click(); // exactly one tap, no typing
  // A loading row may render first; the trending rows must follow within the generous window.
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => effectiveOpacity(trendingRows(page).first()), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(0.95);
});

test('b. P3 regression — blur then quick refocus must NOT strand a dead selector', async ({ page }) => {
  await home(page);
  await cityInput(page).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 10_000 });
  // Blur (tap outside), then re-tap the field with NO wait in between — the old stale 150ms close
  // timer used to fire AFTER this refocus and kill the dropdown while the input stayed focused.
  await page.mouse.click(10, 400);
  await cityInput(page).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 2_000 });
  // And it must STAY open once the old timer's window (150ms) has passed.
  await page.waitForTimeout(400);
  await expect(trendingRows(page).first()).toBeVisible();
});

test('c. selecting a city shows the LOC_IMG identity beside the value', async ({ page }) => {
  await home(page);
  await pickRiyadh(page);
});

test('d. P4 — district multi-select stays open across TWO picks, chips carry visuals', async ({ page }) => {
  await home(page);
  await pickRiyadh(page);
  await districtInput(page).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 10_000 });
  // Two picks, back to back. After EACH, the list must still be there (the whole point of
  // multi-select) — before the fix it vanished after the first tap.
  await trendingRows(page).nth(0).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 2_000 });
  await trendingRows(page).nth(1).click();
  await page.waitForTimeout(400); // outlive the (cancelled) 150ms close window
  await expect(trendingRows(page).first()).toBeVisible();
  const chips = page.getByTestId('district-chip');
  await expect(chips).toHaveCount(2, { timeout: 10_000 });
  // Each chip carries the district art (RNW renders Image as <img> or a background-image div).
  for (let i = 0; i < 2; i++) {
    await expect(chips.nth(i).locator('img, [style*="background-image"]').first()).toBeVisible();
  }
});

test('e. P7 — tapping the disabled district field lands focus in the city field', async ({ page }) => {
  await home(page);
  await districtInput(page).click(); // no city picked yet
  await expect(cityInput(page)).toBeFocused({ timeout: 5_000 });
});

test('f. visual + Arabic-leak barrier — every trending row carries the loc art, no Latin text in either dropdown', async ({ page }) => {
  await home(page);
  await cityInput(page).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 10_000 });
  const assertRows = async () => {
    const rows = trendingRows(page);
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      await expect(row.locator('img, [style*="background-image"]').first()).toBeVisible();
      const text = (await row.textContent()) ?? '';
      expect(text, `Latin leak in row ${i}: «${text}»`).not.toMatch(LATIN);
    }
  };
  await assertRows(); // city dropdown
  await pickRiyadh(page);
  await districtInput(page).click();
  await expect(trendingRows(page).first()).toBeVisible({ timeout: 10_000 });
  await assertRows(); // district dropdown
});
