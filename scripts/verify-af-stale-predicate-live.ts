// THE STALE-ANSWER FIX, PROVEN IN A REAL BROWSER AGAINST PRODUCTION.
//
// scripts/verify-af-answers-die-with-their-scope.ts proves the PRUNE is correct and wired, offline
// and exhaustively (3,588 cohort pairs). It cannot prove the thing the owner actually asked about:
// that a real person, clicking real controls on the deployed bundle, does not carry an Advanced
// Filter answer into a property type that never offered it.
//
// THE JOURNEY (the owner's own «Villa → Land» shape, run as Apartment → Land because Apartment is
// the cohort with the richest certified question set, so there is most to leave behind):
//
//   1. Residential · الرياض · شقة  → بحث
//   2. open Advanced Filter, ANSWER one question by tapping a real option
//      → the committed answer must appear in the search request (proves the answer was real)
//   3. go back to the filter and switch the type to أرض سكنية (Residential Land)
//   4. بحث again, and capture the request the browser actually sends
//      → NOT ONE uncertified AF predicate may be on it
//
// Residential Land certifies exactly [street_width, direction]. So p_bath_min, p_age_min/max,
// p_is_new_construction, p_amenities, p_furnished, p_rating_min, p_reviews_min and p_unit_subtypes
// must all be ABSENT from step 4's body. Before the 2026-09-01 fix they survived: nothing cleared
// any of the 11 AF answer fields on a scope change, and land rows have NULL bathrooms against a
// strict-NULL-excluding clause, so the user's search was silently amputated.
//
// This asserts on the REQUEST BODY rather than on the result count, because the body is the exact
// artefact the bug was about — a count can coincidentally look plausible.
//
// LIVE CHECK — excluded from `npm test`, runs in .github/workflows/af-live-truth-check.yml.

import { chromium } from 'playwright';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const BASE = 'https://ezhalah-app.vercel.app';
// The endpoint this journey expects the deployed bundle to be talking to. Resolved through the
// shared helper (never a repo secret) so the check is self-sufficient in a scheduled run —
// verify-live-checks-self-sufficient.ts exists because two barriers once silently never ran for
// exactly that reason. It also makes the journey assert WHICH backend it proved something about:
// a pass against some other project would be worthless.
const { url: EXPECTED_SUPABASE } = resolvePublicSupabase(process.env);

const CLICK_LEAF = (txt: string) => {
  let best: any = null;
  document.querySelectorAll('div,span,li,button').forEach((e: any) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc: any = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

// Everything Residential Land does NOT certify. (It certifies street_width + direction only.)
const FORBIDDEN_ON_LAND = [
  'p_bath_min', 'p_bath_exact', 'p_age_min', 'p_age_max', 'p_is_new_construction',
  'p_age_unknown', 'p_amenities', 'p_furnished', 'p_rating_min', 'p_reviews_min', 'p_unit_subtypes',
];

const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});

const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const searches: any[] = [];
const searchOrigins = new Set<string>();
page.on('response', async (r) => {
  if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
  try { searchOrigins.add(new URL(r.url()).origin); } catch {}
  try {
    const j = await r.json();
    if (Array.isArray(j)) searches.push(JSON.parse(r.request().postData() || '{}'));
  } catch {}
});

const tap = async (txt: string, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  let box: any = null;
  while (Date.now() < until) {
    box = await page.evaluate(CLICK_LEAF, txt);
    if (box) break;
    await page.waitForTimeout(300);
  }
  if (!box) throw new Error(`control never rendered: ${txt}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ── 1. Apartment search ────────────────────────────────────────────────────────────────────────
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', 'الرياض');
  await tap('الرياض').catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  await tap('الشقق والسكن المشترك');
  await tap('شقة');
  await tap('بحث');
  await page.waitForTimeout(14000);

  // ── 2. answer one AF question for real ────────────────────────────────────────────────────────
  await page.evaluate(() => {
    [...document.querySelectorAll('*')]
      .filter((e: any) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY))
      .forEach((e: any) => { e.scrollTop = e.scrollHeight; });
  });
  await page.waitForTimeout(1500);
  await tap('خلّنا نحدد الطلب أكثر').catch(async () => { await tap('نحدد الطلب أكثر'); });
  await page.waitForTimeout(3500);

  // The app's OWN testids, not a text heuristic: a label-matching scrape picked up the «#1» rank
  // chrome instead of an option, so nothing committed and step 4 proved nothing.
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
  check('an AF option was rendered to answer', opts.length > 0, `options: ${opts.slice(0, 4).join(', ')}`);
  // CONFIRM ADVANCES THE INTERVIEW, IT DOES NOT SEARCH. Advanced Filter asks a ROUND of questions;
  // one af-confirm moves to the next question, and the search fires only when the round ends. A
  // single tap-and-confirm therefore left the answer uncommitted and made this whole journey
  // vacuous. Answer through the interview until a NEW search request actually arrives.
  const searchesBeforeAf = searches.length;
  for (let round = 1; round <= 8 && searches.length === searchesBeforeAf; round++) {
    const roundOpts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
    if (!roundOpts.length) break;
    await page.click(`[data-testid="${roundOpts[0]}"]`);
    await page.waitForTimeout(1500);
    const confirm = await page.$('[data-testid="af-confirm"]');
    if (!confirm) break;
    await confirm.click();
    await page.waitForTimeout(4000);
  }
  // Give the final search time to land even if the last confirm ended the round.
  for (let i = 0; i < 12 && searches.length === searchesBeforeAf; i++) await page.waitForTimeout(1500);

  const ALL_AF = [...FORBIDDEN_ON_LAND, 'p_street_width_min', 'p_street_width_max', 'p_directions'];
  const afSearch = searches[searches.length - 1] ?? {};
  const anyAf = ALL_AF.filter((k) => afSearch[k] != null);
  console.log(`      [diag] ${searches.length} request(s); AF predicates on the last Apartment request: ` +
    `${anyAf.map((k) => `${k}=${JSON.stringify(afSearch[k])}`).join(', ') || '(none)'}`);
  // The journey is meaningful if ANY AF answer committed; it is a STRONG test only if at least one
  // of them is uncertified for Land (direction/street_width are certified there, so they prove
  // nothing about pruning).
  const applied = FORBIDDEN_ON_LAND.filter((k) => afSearch[k] != null);
  check('an AF answer reached the Apartment search (the journey is meaningful)',
    anyAf.length > 0,
    `AF predicates applied: ${anyAf.join(', ') || '(none — the answer never committed)'}`);
  check('at least one applied predicate is UNCERTIFIED for Land (so step 4 is a real test)',
    applied.length > 0,
    `predicates on the Apartment request: ${applied.join(', ') || '(none — the answer never committed, so step 4 would prove nothing)'}`);

  // ── 3. switch the property type to Land ───────────────────────────────────────────────────────
  const before = searches.length;
  await tap('تعديل البحث').catch(async () => { await page.goBack(); await page.waitForTimeout(2500); });
  await page.waitForTimeout(2500);
  // A type box TOGGLES. Tapping أرض سكنية without first clearing شقة yields Apartment+Land — a
  // multi-type scope, which is a different (also valid) transition. Deselect Apartment first so
  // this journey is the single-type REPLACEMENT the owner named.
  await tap('شقة').catch(() => {});
  await page.waitForTimeout(600);
  await tap('الأراضي السكنية');
  await tap('أرض سكنية');
  await tap('بحث');
  await page.waitForTimeout(14000);

  // ── 4. THE ASSERTION ──────────────────────────────────────────────────────────────────────────
  const landSearch = searches[searches.length - 1] ?? {};
  check('a new search request was captured after switching to Land', searches.length > before,
    `captured ${searches.length - before} new request(s)`);
  check('the Land request really is scoped to Land',
    Array.isArray(landSearch.p_types) && landSearch.p_types.includes('أرض سكنية'),
    `p_types=${JSON.stringify(landSearch.p_types)}`);

  check('the journey exercised the expected production backend',
    searchOrigins.size === 1 && searchOrigins.has(new URL(EXPECTED_SUPABASE).origin),
    `saw ${[...searchOrigins].join(', ') || '(none)'}, expected ${new URL(EXPECTED_SUPABASE).origin}`);

  const survivors = FORBIDDEN_ON_LAND.filter((k) => landSearch[k] != null);
  check('NOT ONE uncertified AF predicate survived Apartment → Land',
    survivors.length === 0,
    survivors.length
      ? `STALE on the Land request: ${survivors.map((k) => `${k}=${JSON.stringify(landSearch[k])}`).join(', ')}\n      ` +
        'Land rows have NULL for these and the clause is strict-NULL-excluding, so the user\'s ' +
        'search is silently amputated with nothing on screen to explain it.'
      : 'clean — the Land search carries only what Land certifies');
} catch (e: any) {
  check('the journey completed without a harness error', false, e.message);
} finally {
  await ctx.close();
  await browser.close();
}

console.log(failures ? `\n✗ ${failures} check(s) FAILED\n` : '\n✓ no stale AF predicate crosses a property-type change, in the real browser\n');
process.exit(failures ? 1 : 0);
