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

// Select a property group then a type — this reveals the refine card (bedrooms + area + price).
async function pickGroupType(page: Page, group: string, type: string) {
  await page.getByText(group, { exact: true }).click();
  await page.getByText(type, { exact: true }).click();
}

// The four range inputs all use placeholder "—", in DOM order: areaMin, areaMax, priceMin, priceMax.
const rangeInput = (page: Page, i: number) => page.getByPlaceholder('—').nth(i);

// Run the search and wait for the agent summary (deterministic — appears regardless of whether the
// result-count line has finished its transient fetch). Used by the refine-permutation tests, which
// assert the FILTER WAS APPLIED by reading the ACTUAL search RPC request body, not a URL side-effect.
//
// Why not read page.url() (what this used to do): since PR#706 (owner 2026-08-16, "refresh must
// never re-execute search") the agent screen SCRUBS `?filter=`/`?seed=` from the URL the moment it
// consumes them (src/app/agent.tsx consumeSearchParams) — deliberately, so a reload can never replay
// a search. That scrub turned out to be synchronous enough that even capturing page.url() immediately
// after page.waitForURL() resolved still observed the already-bare `/agent` (verified live,
// 2026-08-17: run 31999056797 failed identically after that fix). The URL is simply never a reliable
// window onto the payload for this screen anymore — intercepting the real network call is.
//
// `matchBody` lets each caller identify ITS OWN request (rather than the first, in case some other
// location_search_candidates_ar call — e.g. a live district count — races it), by checking for the
// param value only that filter's search would send. Returns the parsed JSON body so the caller can
// assert on it directly — a strictly stronger guarantee than the URL ever was, since it proves the
// value reached the actual backend query, not just a client-side query-string echo.
async function runSearchToSummary(page: Page, matchBody: (body: any) => boolean): Promise<any> {
  const rpcRequest = page.waitForRequest(
    (req) => req.method() === 'POST'
      && req.url().includes('/rpc/location_search_candidates_ar')
      && matchBody(req.postDataJSON() ?? {}),
    { timeout: 60_000 },
  );
  await page.getByText('بحث', { exact: true }).click();
  const req = await rpcRequest;
  await expect(page.getByText('ملخص البحث').first()).toBeVisible({ timeout: 60_000 });
  return req.postDataJSON();
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
  // Buy+Rent combined multi-select (owner 2026-08-20): شراء/إيجار are two independent toggles
  // (mirrors سنوي/شهري) — a single tap on the OFF button ADDS it rather than swapping. Home starts
  // on شراء, so reaching إيجار-ONLY needs the same two-tap sequence a single period already does:
  // tap إيجار (→ both), tap شراء (turns Buy off → Rent-only) — only then does شهري exist to tap.
  await page.getByText('إيجار', { exact: true }).click();   // Rent (both, briefly)
  await page.getByText('شراء', { exact: true }).click();    // turn Buy off → Rent-only
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

// PAID LIVE-MODEL TESTS (owner rule 2026-08-29: bounded, explicitly-labelled paid AI only).
// The two tests below type into the chat composer, so each Enter is a BILLED DeepSeek call — and
// playwright.config.ts sets `retries: 2`, so a flaky night bills each of them three times over.
//
// They are real live-agent verification and worth keeping, but they must be a DELIBERATE cost, not
// an incidental one: `npx playwright test` runs the whole e2e/ directory, so without this gate any
// future workflow that runs the suite silently starts paying. Enabled in the nightly ui-parity
// workflow via EZHALAH_ALLOW_PAID_AI=1; skipped everywhere else.
// Pinned by scripts/verify-ai-spend-safety.ts.
const ALLOW_PAID_AI = process.env.EZHALAH_ALLOW_PAID_AI === '1';

test('AI mode — free-text query classifies correctly, replies in Arabic', async ({ page }) => {
  test.skip(!ALLOW_PAID_AI, 'paid live-model test — set EZHALAH_ALLOW_PAID_AI=1 to run');
  await home(page);
  await page.getByText('الوكيل الذكي', { exact: true }).click(); // switch to AI mode
  // The composer's `placeholder` attribute is intentionally EMPTY on the clean intro-landing screen
  // (PR#1008, 2026-08-24): rotating example queries occupy that slot instead, and the static
  // placeholder only returns after the user interacts. getByPlaceholder(...) therefore matches ZERO
  // elements here and every AI-mode test failed from that commit onward (2026-08-24 through
  // 2026-08-28, unnoticed). The accessibilityLabel is stable across BOTH states by design (owner
  // brief §11: "a screen reader always hears this one sentence for the field") — use that instead.
  const composer = page.getByLabel('اكتب وصف العقار اللي تبحث عنه');
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
  test.skip(!ALLOW_PAID_AI, 'paid live-model test — set EZHALAH_ALLOW_PAID_AI=1 to run');
  await home(page);
  await page.getByText('الوكيل الذكي', { exact: true }).click();
  // Stable accessibilityLabel, not the transient placeholder — see the comment on the test above.
  const composer = page.getByLabel('اكتب وصف العقار اللي تبحث عنه');
  await composer.fill('شقة للإيجار في الرياض');
  await composer.press('Enter');
  // «الرياض» is both a city and a region → the agent must ASK, not silently pick one (anti-guess).
  await expect(page.getByText(/مدينة الرياض ولا منطقة الرياض/).first()).toBeVisible({ timeout: 60_000 });
});

// ── Refine-filter permutations: bedrooms, area, price. Each proves the control is applied end-to-end
// (asserted from the actual location_search_candidates_ar RPC request body — see runSearchToSummary
// — deterministic regardless of result count) AND returns results.

test('Filter mode — bedrooms filter (3) is applied and returns results', async ({ page }) => {
  await home(page);
  await pickCity(page, 'الرياض');
  await pickGroupType(page, 'الفلل والبيوت', 'فيلا');
  await page.getByText('3', { exact: true }).click(); // bedroom chip
  const body = await runSearchToSummary(page, (b) => Array.isArray(b.p_beds_exact) && b.p_beds_exact.includes(3));
  expect(body.p_beds_exact).toEqual([3]);
});

test('Filter mode — price max is applied and returns results', async ({ page }) => {
  await home(page);
  await page.getByText('شراء', { exact: true }).click(); // Buy
  await pickCity(page, 'الرياض');
  await pickGroupType(page, 'الشقق والسكن المشترك', 'شقة');
  await rangeInput(page, 3).fill('5000000');  // priceMax = 5,000,000 ر.س
  const body = await runSearchToSummary(page, (b) => b.p_price_max === 5000000);
  expect(body.p_price_max).toBe(5000000);
});

test('Filter mode — area min is applied and returns results', async ({ page }) => {
  await home(page);
  await pickCity(page, 'الرياض');
  await pickGroupType(page, 'الشقق والسكن المشترك', 'شقة');
  await rangeInput(page, 0).fill('100');       // areaMin = 100 م²
  const body = await runSearchToSummary(page, (b) => b.p_area_min === 100);
  expect(body.p_area_min).toBe(100);
});
