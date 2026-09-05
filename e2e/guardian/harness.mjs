// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GUARDIAN — the shared driving layer for the production journey suite.
//
// WHY THIS EXISTS. The repo has ~344 offline barriers and several live checks, and entire
// user-facing surfaces still have ZERO live browser coverage: dark mode, New Chat starting blank,
// the signed-out auth surface, Back after a search, ResultCard field content, loaders resolving,
// the /about + /support doors, empty-result honesty. Those are exactly the surfaces the owner keeps
// finding bugs on personally. This suite drives them against production every day and files an
// OWNED incident (ops_incident) when one breaks.
//
// TWO RULES SHAPE EVERY LINE HERE:
//
//  1. READ-ONLY. Never sign in, never submit a form, never write anything through the UI. The
//     support form is ASSERTED TO RENDER and never sent — `FORBIDDEN_LABELS` makes that structural
//     rather than a habit, and scripts/verify-guardian-journeys.ts mutation-proves the guard.
//
//  2. NO FALSE POSITIVES. A journey that cries wolf trains everyone to ignore alerts — which is
//     the exact failure this system already has (11 deploys reported failure while shipping fine).
//     So a HARNESS failure (navigation timeout, network error, a selector missing because the page
//     never loaded) is `UNDETERMINED`: the run goes red, and NO product incident is filed. Only an
//     invariant violated on a page that demonstrably loaded is a product FAIL. Everything polls
//     with a budget; there are no fixed sleeps standing in for a condition.
//
// Assertions are SHAPE and INVARIANTS, never counts or specific listings — the inventory changes
// hourly and an oracle that depends on it accuses the product of its own staleness.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';

/** The two viewports every journey runs on. The barrier pins both. */
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

/** The property-search RPC. Journeys count these to prove "no search fired" / "no duplicate". */
export const SEARCH_RPC = '/rpc/location_search_candidates_ar';

/**
 * ONE RPC NAME, TWO COMPLETELY DIFFERENT ACTS — never count by name alone (§11.3, owner-locked).
 *
 * `location_search_candidates_ar` is reused for BOTH the submitted results search AND the per-option
 * COUNT calls that decorate whatever scope options happen to be on screen (`fetchScopeOptionCounts`
 * / `fetchDistrictEligibleCounts`, src/data/remote.ts:920/:965 — one call per VISIBLE option, always
 * `p_limit: 1`). The results search is the one with a real page size (`p_limit: 1500`).
 *
 * So the call COUNT is a property of how many options a screen decided to decorate — it moves with
 * the data and with the layout — while the number of SEARCHES SUBMITTED is the thing every journey
 * here actually asserts on. §11.3 records the false verdict this exact conflation already produced
 * once in the other suite («double-click fired the search twice» when both sides had submitted
 * exactly one search), which is why `e2e/journeys/harness.mjs` classifies. This suite did not, and
 * on 2026-09-05 it filed P1 ops_incident #51 — «New Chat fired 1 property-search RPC, it must
 * execute nothing» — against a Filter home that had submitted nothing and merely counted an option.
 *
 * Same taxonomy as classifySearchRpc() in e2e/journeys/harness.mjs, over a raw request body.
 */
export function isResultsSearch(body) {
  return typeof body?.p_limit === 'number' && body.p_limit > 1;
}

/**
 * Controls this suite may NEVER click, whatever a journey asks for. `tap()` refuses them.
 * «إرسال» sends the support message form, which WRITES to support_messages — a live production
 * write from a monitoring run. The guard lives here, in the one place every click goes through,
 * rather than as a rule each journey has to remember.
 */
export const FORBIDDEN_LABELS = ['إرسال', 'حاول مرة أخرى', 'المتابعة باستخدام Google', 'المتابعة باستخدام Apple'];

// ── failure taxonomy ─────────────────────────────────────────────────────────────────────────────
/** The page never got into a state where the product could be judged. NEVER files an incident. */
export class HarnessError extends Error {
  constructor(message) { super(message); this.name = 'HarnessError'; }
}

/** A journey's verdict. `violations` non-empty ⇒ product FAIL. */
export const ok = (evidence = {}) => ({ violations: [], evidence });
export const violated = (violations, evidence = {}) => ({ violations, evidence });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/**
 * Poll `fn` until it returns a truthy value or the budget runs out. Returns the value, or null.
 * The ONLY waiting primitive in this suite — a fixed sleep is either flaky or needlessly slow, and
 * both of those end up reading as a product failure.
 */
export async function until(fn, budgetMs, everyMs = 300) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(everyMs);
  }
}

// ── browser ──────────────────────────────────────────────────────────────────────────────────────
// Playwright is imported LAZILY so scripts/verify-guardian-journeys.ts can import the journey
// definitions (in `npm test`, which is pure and hermetic) without pulling a browser driver in.
const launchOpts = () => ({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY },
        args: ['--no-sandbox', '--disable-quic', '--ignore-certificate-errors', '--ssl-version-max=tls1.2'] }
    : {}),
});

// React's minified hydration notices fire on this statically-rendered export, PREDATE this suite and
// break no journey (project memory react-418-is-preexisting-not-the-both-feature-2026-08-15; the
// same allowance scripts/verify-web-runtime-smoke.mjs makes). Treating them as product failures
// would fail every journey nightly on a defect nobody introduced — the cry-wolf shape this suite
// must not have. Anything else uncaught is a real finding.
const BENIGN_PAGE_ERROR = /Minified React error #(418|423|425)/;

/**
 * Run `fn(page, ctx)` in a fresh browser at `viewport`.
 * `ctx.searches` is every location_search_candidates_ar body the page sent, in order — the RAW
 * traffic, kept for evidence. `ctx.resultsSearches` is the subset that actually SUBMITTED a search
 * (isResultsSearch); assert on that one, never on the raw count.
 * `ctx.pageErrors` is every uncaught page error.
 */
export async function withPage(viewport, fn) {
  const { chromium, devices } = await import('@playwright/test');
  const browser = await chromium.launch(launchOpts());
  const base = viewport.mobile ? devices['iPhone 13'] : devices['Desktop Chrome'];
  const context = await browser.newContext({
    ...base,
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'ar-SA',
    ...(viewport.colorScheme ? { colorScheme: viewport.colorScheme } : {}),
  });
  const page = await context.newPage();
  const searches = [];
  const resultsSearches = [];
  const pageErrors = [];
  page.on('request', (r) => {
    if (!r.url().includes(SEARCH_RPC)) return;
    let body;
    try { body = JSON.parse(r.postData() || '{}'); } catch { body = {}; }
    searches.push(body);
    // A journey asserting "no search fired" means SUBMITTED — never the p_limit:1 option counts
    // that ride the same RPC name. See isResultsSearch() above and ops_incident #51.
    if (isResultsSearch(body)) resultsSearches.push(body);
  });
  page.on('pageerror', (e) => { const m = String(e); if (!BENIGN_PAGE_ERROR.test(m)) pageErrors.push(m.slice(0, 240)); });
  try {
    return await fn(page, { searches, resultsSearches, pageErrors, viewport });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── loading the app ──────────────────────────────────────────────────────────────────────────────
/**
 * Navigate and wait until the app has actually RENDERED. Anything that fails here is a HARNESS
 * failure by construction: if the filter form never mounted, nothing downstream can be a statement
 * about the product.
 */
export async function open(page, path = '/', { expect = '[data-testid="city-input"]' } = {}) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 90000 })
    .catch((e) => { throw new HarnessError(`navigation to ${path} failed: ${String(e).slice(0, 160)}`); });
  if (res && res.status() >= 500) throw new HarnessError(`${path} answered HTTP ${res.status()} — production is not serving the app`);
  if (expect) {
    const rendered = await until(() => page.$(expect), 45000);
    if (!rendered) throw new HarnessError(`${path} loaded but ${expect} never rendered — the app did not boot`);
  }
  await waitForHydration(page, path);
}

// HYDRATION IS NOT PAGE LOAD, and on this app the difference is a false PASS.
// Expo's static export ships pre-rendered markup, so `[data-testid="city-input"]` exists in the raw
// HTML before a single line of app code has run — measured 2026-09-04: the served / carries exactly
// ONE data-testid, and the client-rendered tree carries eight or more. The first version of the
// theme journey therefore "passed" in 1s against markup React had not touched yet, and the same read
// on a phone returned zero text samples. So the gate is the CLIENT-rendered tree existing, not the
// document being loaded.
const HYDRATED_MIN_TESTIDS = 3;
export async function waitForHydration(page, path = '/') {
  const hydrated = await until(
    async () => (await page.evaluate(() => document.querySelectorAll('[data-testid]').length)) >= HYDRATED_MIN_TESTIDS,
    45000, 250);
  if (!hydrated) throw new HarnessError(`${path} served its static markup but the app never hydrated (fewer than ${HYDRATED_MIN_TESTIDS} client-rendered testids)`);
}

// ── visibility, the one definition ───────────────────────────────────────────────────────────────
// `offsetParent !== null` is WRONG here and quietly so: react-native-web renders the sign-in card
// and every modal at `position: fixed`, for which offsetParent is null — so the naive predicate
// reports the most important overlay in the app as invisible. Measured 2026-09-04 while building
// this suite: the signed-out card read as absent on every load. Rect + computed style instead.
// The predicate is declared inline in each page.evaluate rather than injected as a source string:
// a page CSP can forbid dynamic evaluation, and a visibility predicate that silently throws would
// report every overlay as absent — the same blindness this comment exists to prevent, one layer down.
export const countVisible = (page, selector) => page.evaluate((sel) => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  };
  return [...document.querySelectorAll(sel)].filter(vis).length;
}, selector);

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

// ── clicking ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Click the leaf carrying exactly this Arabic label. Scrolls it into view from the DOM first:
 * Playwright's own scrollIntoViewIfNeeded() does not move a react-native-web ScrollView, which is
 * why controls below the fold on a 390 px phone otherwise time out (measured in the live sweep;
 * see e2e/live-sweep/sweep.mjs runSearch).
 * Returns true when the click landed. NEVER clicks a FORBIDDEN_LABELS control.
 */
export async function tap(page, label, timeout = 15000) {
  if (FORBIDDEN_LABELS.includes(label)) {
    throw new Error(`guardian refuses to click «${label}» — this suite is read-only against production`);
  }
  const el = page.getByText(label, { exact: true }).first();
  const there = await el.waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);
  if (!there) return false;
  await page.evaluate((t) => {
    for (const e of document.querySelectorAll('*')) {
      if (e.children.length === 0 && (e.textContent || '').trim() === t) { e.scrollIntoView({ block: 'center' }); return; }
    }
  }, label).catch(() => {});
  await sleep(400);
  return el.click({ timeout }).then(() => true).catch(() => false);
}

/** The auth invitation has TWO presentations and they are dismissed differently. Both are the one
 *  AuthForm (src/lib/authPopupBehavior.ts), and they are mutually exclusive by design — the card is
 *  suppressed while the modal is open — so counting both selectors yields exactly one whenever an
 *  invitation is on screen, on either viewport. */
export const AUTH_INVITATION_SELECTOR = '[data-testid="auth-popup"],[data-testid="signin-card"]';

/**
 * Close the signed-out sign-in invitation, the way a real guest does.
 * Returns 'dismissed' | 'absent' | 'still-open' — never throws: on a narrow viewport the product may
 * legitimately not offer the card unprompted, and "it was not there" is a fact, not a failure.
 *
 * TWO DISMISSAL MECHANISMS, BECAUSE THE PRODUCT HAS TWO (incident #23, fixed 2026-09-05). The
 * compact SignInCard keeps its ×. The centered AuthModal deliberately has NO × on its main step
 * (owner 2026-09-03, AuthModal.tsx:272) — «a press on the ground closes it», the outer Pressable
 * that fills the viewport. Looking only for the × made this return 'stuck' against a modal that
 * closes perfectly well, which is why the earlier attempt at incident #23 had to be reverted: the
 * detector was fixed while the dismissal was left blind, so the modal stayed up and covered the city
 * field in four unrelated mobile journeys. Measured on production 2026-09-05, mobile 375, 2/2 fresh
 * contexts: a ground press at (10,10) takes auth-popup from 1 to 0.
 */
export async function dismissAuthInvitation(page, budgetMs = 6000) {
  const invitation = await until(() => page.$(AUTH_INVITATION_SELECTOR), budgetMs);
  if (!invitation) return 'absent';
  const close = await page.$('[data-testid="auth-popup-close"]');
  if (close) await close.click().catch(() => {});
  else await page.mouse.click(10, 10).catch(() => {});  // the empty ground, well clear of the card
  const gone = await until(async () => (await countVisible(page, AUTH_INVITATION_SELECTOR)) === 0, 8000);
  return gone ? 'dismissed' : 'still-open';
}

// ── driving a real search ────────────────────────────────────────────────────────────────────────
/** Every terminal state the results screen can reach. Shared with the live sweep's SETTLED_RE. */
export const SETTLED_RE = /لقينا|ما لقيت|ما فيه/;

/**
 * Type a city and commit it. Returns true only when the APP confirmed the selection (the field
 * holds it) — a click that missed leaves the search to be refused later, which reads as a broken
 * product instead of a harness miss.
 */
export async function pickCity(page, city) {
  const input = page.locator('[data-testid="city-input"]');
  await input.click();
  await input.fill(city);
  const optionSrc = (c) => [...document.querySelectorAll('div')].filter((e) => {
    const t = (e.innerText || '').trim();
    return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
  }).pop();
  const appeared = await page.waitForFunction(
    (c) => [...document.querySelectorAll('div')].some((e) => {
      const t = (e.innerText || '').trim();
      return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
    }), city, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!appeared) return false;
  const handle = await page.evaluateHandle(optionSrc, city);
  const option = handle.asElement();
  if (!option) return false;
  await option.scrollIntoViewIfNeeded().catch(() => {});
  await option.click().catch(() => {});
  const committed = await until(async () => {
    const v = await input.inputValue().catch(() => '');
    return v && (v.includes(city) || city.includes(v)) ? v : null;
  }, 8000);
  return !!committed;
}

/** Press «بحث» and wait for the results screen to reach a terminal state. Harness-fails if not. */
export async function runSearch(page, budgetMs = 90000) {
  const search = page.getByText('بحث', { exact: true }).first();
  const there = await search.waitFor({ state: 'attached', timeout: 30000 }).then(() => true).catch(() => false);
  if (!there) throw new HarnessError('«بحث» never mounted');
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('*')) {
      if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') { e.scrollIntoView({ block: 'center' }); return; }
    }
  }).catch(() => {});
  await sleep(600);
  const clicked = await search.click({ timeout: 30000 }).then(() => true).catch(() => false);
  if (!clicked) throw new HarnessError('«بحث» was mounted but could not be clicked');
  const settled = await until(async () => SETTLED_RE.test(await bodyText(page)), budgetMs, 500);
  if (!settled) throw new HarnessError(`the results screen never settled within ${budgetMs}ms`);
  await waitForCards(page);
}

/**
 * The count line lands BEFORE the cards finish mounting, and cards mount progressively.
 * Judging the results the moment the first card exists reads a partial page: measured 2026-09-04,
 * the card journey inspected 2 of the 18 cards production had rendered — a per-card oracle that
 * silently sees 11% of the evidence is barely an oracle at all. So wait for the count to STOP
 * changing, and take an honest zero as its own settled state rather than burning the budget on it.
 */
const ZERO_STATE_RE = /ما فيه نتائج|ما لقيت|ما لقينا/;
export async function waitForCards(page, budgetMs = 30000) {
  let last = -1;
  let stable = 0;
  await until(async () => {
    if (ZERO_STATE_RE.test(await bodyText(page))) return true;
    const n = await countVisible(page, '[data-testid^="card-listing-"]');
    if (n > 0 && n === last) stable += 1; else { stable = 0; last = n; }
    return stable >= 2;
  }, budgetMs, 700);
}

/** The whole "guest runs a real search" preamble, as one call. */
export async function searchAsGuest(page, { city = 'الرياض', priceMin, priceMax } = {}) {
  await open(page, '/');
  await dismissAuthInvitation(page);
  if (!await pickCity(page, city)) throw new HarnessError(`the product did not offer the city «${city}»`);
  if (priceMin != null) await page.locator('[data-testid="price-min-input"]').fill(String(priceMin)).catch(() => {});
  if (priceMax != null) await page.locator('[data-testid="price-max-input"]').fill(String(priceMax)).catch(() => {});
  if (priceMin != null || priceMax != null) await sleep(1200);
  await runSearch(page);
}

/** The results screen's own state, as the user sees it. */
export const resultsState = (page) => page.evaluate(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  };
  const text = document.body.innerText;
  return {
    url: location.href,
    countChip: (text.match(/لقينا\s+([\d,٬]+)\s+إعلان/) || [])[1] ?? null,
    cards: [...document.querySelectorAll('[data-testid^="card-listing-"]')].filter(vis).length,
    firstCard: document.querySelector('[data-testid^="card-listing-"]')?.getAttribute('data-testid') ?? null,
    loadMore: [...document.querySelectorAll('[data-testid="results-load-more"]')].filter(vis).length,
    afCards: [...document.querySelectorAll('[data-testid="af-card"]')].filter(vis).length,
    composers: [...document.querySelectorAll('textarea')].filter(vis).map((e) => e.value),
  };
});

// ── loading affordances ──────────────────────────────────────────────────────────────────────────
// A "loader" is anything that says work is in flight. Named explicitly rather than guessed at from
// CSS animation, because react-native-reanimated drives its animations from JS transforms — there
// is no animation-name to read, so a heuristic would find nothing and pass forever.
export const LOADER_TEXTS = ['يبحث في المنصات', 'جاري التحميل', 'جارٍ التحميل', 'جاري البحث'];
export const LOADER_SELECTORS = '[role="progressbar"],[data-testid*="shimmer"],[data-testid="voice-processing"]';

/** Loading affordances visible right now. Empty === the surface has resolved. */
export const loadersPresent = (page) => page.evaluate(([sel, texts]) => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  };
  const hits = [...document.querySelectorAll(sel)].filter(vis)
    .map((e) => `element:${e.getAttribute('data-testid') || e.getAttribute('role')}`);
  const t = document.body.innerText;
  for (const p of texts) if (t.includes(p)) hits.push(`text:${p}`);
  return hits;
}, [LOADER_SELECTORS, LOADER_TEXTS]);

// ── colour ───────────────────────────────────────────────────────────────────────────────────────
/** sRGB relative luminance (WCAG). PURE — the barrier executes it. */
export function relativeLuminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two rgb triples. PURE. */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** '#171717' | 'rgb(23,23,23)' | 'rgba(23,23,23,1)' → [r,g,b], or null. PURE. */
export function parseColor(value) {
  const s = String(value ?? '').trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return parts.slice(0, 3);
}
